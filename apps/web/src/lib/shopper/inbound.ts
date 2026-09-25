import "server-only";
import { createHash } from "node:crypto";
import { classifyTouch, htmlToText, looksLikeBounce, phiSignals, stripQuotedReply } from "@cgs/core";
import type { ShopperDeps } from "./deps";
import { notifyOps } from "./ops";
import { queuePersonaReply } from "./persona-reply";
import type { Assignment, InboundEvent, NewInboundEvent } from "./repo";

// Records everything clinics send back: email replies, texts, calls, and voicemails.
// Each persona address and number belongs to one test at a time, so what arrives on
// it belongs to that test; anything unrecognized goes to a VA to match.

export interface InboundEmail {
  to: string;
  from: string;
  subject?: string | null;
  text?: string | null;
  html?: string | null;
  /** Lowercased header names. */
  headers?: Record<string, string>;
  messageId?: string | null;
  receivedAt?: Date;
  /** File names only; attachment contents are never accepted. */
  attachmentNames?: string[];
}

export type InboundOutcome = { status: "stored" | "duplicate" | "unmatched" | "bounce" | "flagged"; eventId?: string };

const bareAddress = (v: string) => (/<([^>]+)>/.exec(v)?.[1] ?? v).trim().toLowerCase();

const isLate = (a: Assignment, at: Date) => Boolean(a.observeUntil && at > a.observeUntil);

/** Shared steps after storing a touch: PHI tripwire, then a persona reply if one is due. */
async function afterStore(deps: ShopperDeps, a: Assignment, event: InboundEvent, created: boolean, phi: string[]): Promise<InboundOutcome> {
  if (!created) return { status: "duplicate", eventId: event.id };
  if (phi.length) {
    const test = (await deps.repo.getTest(a.testId))!;
    const task = await deps.repo.createTask({
      type: "review_phi",
      title: "Possible patient information received",
      testId: a.testId,
      assignmentId: a.id,
      clinicId: test.clinicId,
      inboundEventId: event.id,
      payload: { signals: phi, channel: event.channel },
      dueAt: new Date(deps.now().getTime() + 4 * 60 * 60_000),
    });
    await deps.repo.audit("system", "phi.flagged", { type: "inbound_event", id: event.id }, { signals: phi });
    // Reasons only: the content itself never goes into alerts.
    await notifyOps(deps, task, [`Signals: ${phi.join(", ")}`, "Admins only. The content is deleted within 7 days."]);
    return { status: "flagged", eventId: event.id };
  }
  await queuePersonaReply(deps, a, event);
  return { status: "stored", eventId: event.id };
}

async function unmatched(deps: ShopperDeps, e: NewInboundEvent, what: string): Promise<InboundOutcome> {
  const { event, created } = await deps.repo.insertInbound({ ...e, assignmentId: null });
  if (created) {
    const task = await deps.repo.createTask({
      type: "match_inbound",
      title: `Match an unrecognized ${what}`,
      inboundEventId: event.id,
      payload: { channel: e.channel, from: e.fromAddr ?? null, to: e.toAddr ?? null },
      dueAt: new Date(deps.now().getTime() + 24 * 60 * 60_000),
    });
    await notifyOps(deps, task, [`From: ${e.fromAddr ?? "unknown"}`, `To: ${e.toAddr ?? "unknown"}`]);
  }
  return { status: created ? "unmatched" : "duplicate", eventId: event.id };
}

export async function recordInboundEmail(deps: ShopperDeps, msg: InboundEmail): Promise<InboundOutcome> {
  const { repo } = deps;
  const receivedAt = msg.receivedAt ?? deps.now();
  const to = bareAddress(msg.to);
  const from = bareAddress(msg.from);
  const headers = Object.fromEntries(Object.entries(msg.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v).slice(0, 2000)]));
  const externalId =
    msg.messageId?.trim() || `sha256:${createHash("sha256").update(`${from}|${to}|${msg.subject ?? ""}|${receivedAt.toISOString()}`).digest("hex")}`;
  const assignment = await repo.assignmentByEmail(to);

  if (looksLikeBounce({ from: msg.from, subject: msg.subject, headers })) {
    if (assignment && assignment.channel === "email") {
      const test = (await repo.getTest(assignment.testId))!;
      if (!test.findings.some((f) => f.kind === "email_bounced")) {
        await repo.addFinding(test.id, { kind: "email_bounced", text: `An inquiry to ${assignment.target} bounced: the clinic's public email address isn't receiving mail.`, at: receivedAt.toISOString(), assignmentId: assignment.id });
        const task = await repo.createTask({
          type: "fix_failure",
          title: "The clinic's email bounced",
          testId: test.id,
          assignmentId: assignment.id,
          clinicId: test.clinicId,
          payload: { reason: "An inquiry email bounced. Remaining email personas should switch to the web form if there is one." },
          dueAt: new Date(deps.now().getTime() + 4 * 60 * 60_000),
        });
        await notifyOps(deps, task, [`Bounced address: ${assignment.target}`]);
      }
    }
    await repo.audit("system", "email.bounced", assignment ? { type: "assignment", id: assignment.id } : null, {});
    return { status: "bounce" };
  }

  const body = stripQuotedReply(msg.text?.trim() ? msg.text : htmlToText(msg.html ?? "")).slice(0, 20_000);
  const subject = msg.subject?.slice(0, 300) ?? null;
  const base: NewInboundEvent = { channel: "email", fromAddr: from, toAddr: to, receivedAt, subject, body, headers, externalId };
  if (!assignment) return unmatched(deps, base, "email");

  const phi = phiSignals(`${subject ?? ""}\n${body}`, msg.attachmentNames ?? []);
  const label = classifyTouch({ channel: "email", subject: subject ?? undefined, text: body, headers });
  const { event, created } = await repo.insertInbound({
    ...base,
    assignmentId: assignment.id,
    label,
    labelSource: "rules",
    late: isLate(assignment, receivedAt),
    phiQuarantined: phi.length > 0,
  });
  if (created) await repo.setLastInboundMessageId(assignment.id, externalId);
  return afterStore(deps, assignment, event, created, phi);
}

export async function recordSms(deps: ShopperDeps, sms: { sid: string; from: string; to: string; body: string; receivedAt?: Date }): Promise<InboundOutcome> {
  const receivedAt = sms.receivedAt ?? deps.now();
  const base: NewInboundEvent = { channel: "sms", fromAddr: sms.from, toAddr: sms.to, receivedAt, body: sms.body.slice(0, 5000), externalId: sms.sid };
  const assignment = await deps.repo.assignmentByPhone(sms.to, receivedAt);
  if (!assignment) return unmatched(deps, base, "text message");
  const phi = phiSignals(sms.body);
  const { event, created } = await deps.repo.insertInbound({
    ...base,
    assignmentId: assignment.id,
    label: classifyTouch({ channel: "sms", text: sms.body }),
    labelSource: "rules",
    late: isLate(assignment, receivedAt),
    phiQuarantined: phi.length > 0,
  });
  return afterStore(deps, assignment, event, created, phi);
}

/** A call is ringing a persona number. Returns the persona's first name for the voicemail greeting. */
export async function recordCallStart(
  deps: ShopperDeps,
  call: { sid: string; from: string; to: string; receivedAt?: Date },
): Promise<{ firstName: string | null; sex: "male" | "female" | null }> {
  const receivedAt = call.receivedAt ?? deps.now();
  const base: NewInboundEvent = { channel: "call", fromAddr: call.from, toAddr: call.to, receivedAt, externalId: call.sid };
  const assignment = await deps.repo.assignmentByPhone(call.to, receivedAt);
  if (!assignment) {
    await unmatched(deps, base, "call");
    return { firstName: null, sex: null };
  }
  await deps.repo.insertInbound({ ...base, assignmentId: assignment.id, label: "personal", labelSource: "rules", late: isLate(assignment, receivedAt) });
  return { firstName: assignment.firstName, sex: assignment.sex };
}

export async function recordCallDetails(
  deps: ShopperDeps,
  sid: string,
  d: { durationSeconds?: number | null; recordingUrl?: string | null; recordingSeconds?: number | null },
) {
  // A recording of a second or two is a hang-up at the beep, not a voicemail.
  const voicemail = d.recordingUrl ? (d.recordingSeconds ?? 0) >= 3 : undefined;
  await deps.repo.updateCall(sid, { durationSeconds: d.durationSeconds ?? null, recordingUrl: voicemail ? d.recordingUrl! : null, voicemail });
}

/** A voicemail's transcript arrived: store it, check it, and let the persona respond if due. */
export async function recordTranscript(deps: ShopperDeps, sid: string, text: string): Promise<InboundOutcome> {
  const existing = await deps.repo.inboundByExternalId(sid);
  if (!existing) return { status: "unmatched" };
  if (existing.body) return { status: "duplicate", eventId: existing.id };
  const phi = phiSignals(text);
  const event = await deps.repo.updateCall(sid, { body: text.slice(0, 5000), voicemail: true });
  if (!event?.assignmentId) return { status: event ? "unmatched" : "duplicate" };
  if (phi.length) await deps.repo.setPhiQuarantine(event.id, true);
  const a = (await deps.repo.getAssignment(event.assignmentId))!;
  return afterStore(deps, a, { ...event, phiQuarantined: phi.length > 0 }, true, phi);
}
