import "server-only";
import { randomUUID } from "node:crypto";
import type { ShopperDeps } from "./deps";
import type { FormSubmission } from "./form-bot";
import { gradeAndQueueQa } from "./grade";
import { notifyOps } from "./ops";
import type { Assignment, InquiryChannel } from "./repo";
import { noResponseAlerts, promoteQueuedRetests } from "./retest";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** How long a VA has to submit a form by hand after its scheduled time (SPEC.md §12). */
const VA_SEND_WINDOW_MS = 2 * HOUR;
/** A claimed inquiry still "sending" after this long means a worker died mid-send. */
const STUCK_AFTER_MS = 15 * MINUTE;
/** Quarantined (possible PHI) message content is deleted after this long (SPEC.md §9.1). */
const PHI_HOLD_MS = 7 * DAY;

export const personaFrom = (a: Pick<Assignment, "firstName" | "lastName" | "email">) => `${a.firstName} ${a.lastName} <${a.email}>`;

/**
 * Records that an inquiry went out, by any route (bot, email, or a VA by hand).
 * The observation clock starts at the actual send time.
 */
export async function markInquirySent(
  deps: ShopperDeps,
  a: Assignment,
  s: { sentAt: Date; sentBy: string; channel: InquiryChannel; target: string | null; messageId?: string | null; evidence?: Record<string, unknown> },
) {
  const { repo, playbook } = deps;
  const t = playbook.personaRules.timing;
  const observeUntil = new Date(s.sentAt.getTime() + t.observation_days * DAY);
  const lateUntil = new Date(observeUntil.getTime() + t.late_days * DAY);
  await repo.transaction(async (tx) => {
    await tx.markSent(a.id, { sentAt: s.sentAt, observeUntil, lateUntil, channel: s.channel, target: s.target, emailMessageId: s.messageId });
    await tx.insertOutbound({
      assignmentId: a.id,
      kind: "inquiry",
      channel: s.channel,
      subject: a.subject,
      body: a.message,
      target: s.target,
      messageId: s.messageId ?? null,
      sentAt: s.sentAt,
      sentBy: s.sentBy,
      evidence: s.evidence,
    });
    const test = (await tx.getTest(a.testId))!;
    await tx.transitionTest(test.id, ["scheduled"], "running", "Inquiries under way");
    // A late send (e.g. by hand) pushes the end of the test out.
    if (test.windowStart && test.windowEnd && lateUntil > test.windowEnd) await tx.setTestWindow(test.id, test.windowStart, lateUntil);
  });
}

async function handToVa(deps: ShopperDeps, a: Assignment, reason: string, evidence: Record<string, unknown> = {}) {
  const { repo } = deps;
  await repo.setSendStatus(a.id, "needs_va");
  if (await repo.openTaskFor(a.channel === "web_form" ? "submit_form" : "fix_failure", { assignmentId: a.id })) return;
  const test = (await repo.getTest(a.testId))!;
  const clinic = (await repo.getClinic(test.clinicId))!;
  const task = await repo.createTask({
    type: a.channel === "web_form" ? "submit_form" : "fix_failure",
    title: a.channel === "web_form" ? `Submit a form for ${clinic.name}` : `Inquiry email didn't send: ${clinic.name}`,
    testId: a.testId,
    assignmentId: a.id,
    clinicId: clinic.id,
    payload: { reason, evidence },
    dueAt: new Date(Math.max(a.scheduledAt.getTime(), deps.now().getTime()) + VA_SEND_WINDOW_MS),
  });
  await notifyOps(deps, task, [`Clinic: ${clinic.name}`, `Reason: ${reason}`, "Due within 2 hours."]);
}

async function sendInquiryEmail(deps: ShopperDeps, a: Assignment) {
  const domain = a.email.split("@")[1]!;
  const messageId = `<${randomUUID()}@${domain}>`;
  const sent = await deps.sendEmail({
    from: personaFrom(a),
    to: a.target!,
    replyTo: null,
    subject: a.subject,
    text: a.message,
    headers: { "Message-ID": messageId },
  });
  await markInquirySent(deps, a, {
    sentAt: deps.now(),
    sentBy: "bot",
    channel: "email",
    target: a.target,
    messageId,
    evidence: { providerId: (sent && sent.id) || null },
  });
}

async function submitForm(deps: ShopperDeps, a: Assignment) {
  if (!deps.formBot) return handToVa(deps, a, "No browser is configured for automatic form submission.");
  let result: FormSubmission;
  try {
    result = await deps.formBot.submit({
      url: a.target!,
      persona: { firstName: a.firstName, lastName: a.lastName, email: a.email, phone: a.phoneNumber },
      subject: a.subject,
      message: a.message,
      serviceName: a.serviceName,
    });
  } catch (err) {
    return handToVa(deps, a, `The form bot crashed: ${(err as Error).message}`);
  }
  const evidence: Record<string, unknown> = { confirmation: result.confirmation ?? null, filled: result.filled ?? [] };
  for (const shot of result.screenshots ?? []) {
    evidence[shot.kind] = await deps.repo.saveEvidence({ testId: a.testId, kind: shot.kind, contentType: "image/png", data: shot.png });
  }
  if (result.status !== "submitted") return handToVa(deps, a, result.reason ?? "The form couldn't be submitted automatically.", evidence);
  await markInquirySent(deps, a, { sentAt: deps.now(), sentBy: "bot", channel: "web_form", target: a.target, evidence });
}

/** Sends every inquiry whose time has come. Failures become VA tasks, never silent drops. */
export async function sendDueInquiries(deps: ShopperDeps, limit = 10): Promise<{ sent: number; toVa: number }> {
  const { repo } = deps;
  let sent = 0;
  let toVa = 0;
  for (const a of await repo.dueAssignments(deps.now(), limit)) {
    if (!(await repo.claimAssignment(a.id))) continue;
    try {
      if (a.channel === "email") await sendInquiryEmail(deps, a);
      else await submitForm(deps, a);
    } catch (err) {
      await handToVa(deps, a, `Sending failed: ${(err as Error).message}`);
    }
    const after = (await repo.getAssignment(a.id))!;
    if (after.sendStatus === "sent") sent++;
    else toVa++;
  }
  return { sent, toVa };
}

/** Inquiries a worker claimed but never finished (it crashed or timed out). */
async function rescueStuck(deps: ShopperDeps): Promise<number> {
  const stuck = await deps.repo.stuckSending(new Date(deps.now().getTime() - STUCK_AFTER_MS));
  for (const a of stuck) {
    // It may or may not have gone out, so a person checks rather than risk a double send.
    await handToVa(deps, a, "Sending started but never finished. Check whether it went out before retrying.");
  }
  return stuck.length;
}

/** Closes tests whose observation (and late) windows have ended, and grades them. */
export async function closeFinishedTests(deps: ShopperDeps): Promise<number> {
  const { repo, playbook } = deps;
  const now = deps.now();
  let closed = 0;
  for (const test of await repo.testsWithStatus(["running"])) {
    const assignments = await repo.assignmentsForTest(test.id);
    if (assignments.some((a) => ["scheduled", "sending", "needs_va"].includes(a.sendStatus))) continue;
    const sent = assignments.filter((a) => a.sendStatus === "sent");
    const end = Math.max(0, ...sent.map((a) => a.lateUntil?.getTime() ?? 0));
    if (sent.length && end > now.getTime()) continue;

    if (!(await repo.transitionTest(test.id, ["running"], "grading", "Grading"))) continue;
    await repo.cancelOpenTasks({ testId: test.id, type: "approve_reply" }, now, "The test window closed");
    await repo.releaseNumbers(test.id, new Date(now.getTime() + playbook.personaRules.timing.number_quarantine_days * DAY));
    await repo.audit("system", "test.closed", { type: "test", id: test.id }, { inquiriesSent: sent.length });
    await gradeAndQueueQa(deps, test.id);
    closed++;
  }
  return closed;
}

export interface TickSummary {
  sent: number;
  toVa: number;
  rescued: number;
  closed: number;
  purged: number;
  retestsStarted: number;
  alerts: number;
}

/** One run of the scheduler (every few minutes via /api/cron/shopper). */
export async function runShopperTick(deps: ShopperDeps): Promise<TickSummary> {
  const rescued = await rescueStuck(deps);
  const { sent, toVa } = await sendDueInquiries(deps);
  const closed = await closeFinishedTests(deps);
  const retestsStarted = await promoteQueuedRetests(deps);
  const alerts = await noResponseAlerts(deps);
  const purged = await deps.repo.purgeQuarantined(new Date(deps.now().getTime() - PHI_HOLD_MS));
  return { sent, toVa, rescued, closed, purged, retestsStarted, alerts };
}
