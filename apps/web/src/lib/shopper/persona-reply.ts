import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mentionsPrice, requestedDeflections, type DeflectionId, type ScriptId } from "@cgs/core";
import type { Result } from "./purchase";
import type { ShopperDeps } from "./deps";
import { notifyOps } from "./ops";
import type { Assignment, InboundEvent } from "./repo";

// In v1 an AI (or template) drafts each persona reply and a VA reviews and sends it
// (SPEC.md §7.1, §9.2). The engaged persona asks one follow-up question; the price
// check persona answers the price with one objection. Then both go quiet.

export interface DraftInput {
  script: ScriptId;
  clinicTypeName: string;
  serviceName: string;
  personaFirstName: string;
  /** The clinic's message (email or text), or a voicemail transcript. */
  clinicMessage: string | null;
  /** The clinic only called or texted, so the persona asks for email instead. */
  missedCall: boolean;
  question: string | null;
  objection: string | null;
  deflections: string[];
  styleRules: string[];
  neverRules: string[];
}

export type AiDraft = (input: DraftInput) => Promise<string | null>;

/** Stable per persona, so re-drafting gives the same question or objection. */
function pickFor(id: string, items: readonly string[]): string | null {
  if (items.length === 0) return null;
  return items[createHash("sha256").update(id).digest().readUInt32BE(0) % items.length]!;
}

/** The fallback draft when AI isn't available (or its draft fails the guardrails). */
export function templateReply(d: DraftInput): string {
  const lines: string[] = [];
  if (d.missedCall) lines.push("Sorry I keep missing your calls. Could you email me the details?");
  else lines.push(d.script === "price_check" ? "Thanks for getting back to me!" : "Thanks so much for getting back to me!");
  lines.push(...d.deflections);
  if (d.script === "price_check") {
    lines.push(d.clinicMessage && mentionsPrice(d.clinicMessage) && d.objection ? d.objection : "Could you give me a rough idea of the price before I come in?");
  } else if (d.question) {
    lines.push(d.question);
  }
  return `${lines.join(" ")}\n\n${d.personaFirstName}`;
}

const GIVES_DETAILS = /\b\d{3}[\s.-]?\d{3}[\s.-]?\d{4}\b|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b\d{3}-\d{2}-\d{4}\b/;
const REVEALS_TEST = /\b(?:secret shopper|mystery shop|test(?:ing)?|grad(?:e|ing)|evaluat|clinic growth|fictional|persona)\b/i;
const BOOKS = /\b(?:book (?:me|it)|i(?:'|’)ll take (?:it|that|the)|see you (?:then|on|at)|confirm(?:ed)? (?:the|my) (?:appointment|booking|time)|my card (?:number|is))\b/i;

/** Hard guardrails for anything sent as a persona. Returns problems, or [] when it's fine to send. */
export function checkPersonaReply(text: string): string[] {
  const problems: string[] = [];
  const t = text.trim();
  if (t.length < 10) problems.push("The reply is empty.");
  if (t.length > 800) problems.push("Keep persona replies short (under 800 characters).");
  if (GIVES_DETAILS.test(t)) problems.push("Remove phone numbers, dates, or ID numbers: personas never share personal details.");
  if (REVEALS_TEST.test(t)) problems.push("Don't mention testing, grading, personas, or our company.");
  if (BOOKS.test(t)) problems.push("Personas never book, confirm, or pay for appointments.");
  return problems;
}

/**
 * After the clinic's first personal touch, queues a reply for a VA to approve and
 * send, due after a natural delay. Does nothing for the silent persona, late
 * touches, flagged messages, or a persona that has already replied.
 */
export async function queuePersonaReply(deps: ShopperDeps, a: Assignment, event: InboundEvent): Promise<boolean> {
  const { repo, playbook } = deps;
  const rules = playbook.personaRules;
  const max = rules.scripts[a.script].max_replies;
  if (max < 1 || a.repliesSent >= max || event.late || event.phiQuarantined || event.label !== "personal") return false;
  const test = await repo.getTest(a.testId);
  if (test?.status !== "running") return false;
  if (await repo.openTaskFor("approve_reply", { assignmentId: a.id })) return false;
  const clinic = (await repo.getClinic(test.clinicId))!;
  const clinicType = playbook.clinicTypes[clinic.clinicType]!;

  const missedCall = event.channel !== "email";
  const to = missedCall ? clinic.publicEmail : event.fromAddr;
  if (!to) return false; // no way to write back by email
  const clinicMessage = event.body;
  const input: DraftInput = {
    script: a.script,
    clinicTypeName: clinicType.name,
    serviceName: a.serviceName,
    personaFirstName: a.firstName,
    clinicMessage,
    missedCall,
    question: a.script === "engaged" ? pickFor(a.id, clinicType.follow_up_questions) : null,
    objection: a.script === "price_check" ? pickFor(a.id, clinicType.price_objections) : null,
    deflections: requestedDeflections(clinicMessage).map((d: DeflectionId) => rules.deflections[d]).filter((x): x is string => Boolean(x)),
    styleRules: rules.reply_style,
    neverRules: rules.never,
  };
  let draft = templateReply(input);
  let draftedBy = "template";
  if (deps.aiDraft) {
    const ai = await deps.aiDraft(input).catch(() => null);
    if (ai && checkPersonaReply(ai).length === 0) {
      draft = ai.trim();
      draftedBy = "ai";
    }
  }

  const delay = rules.timing.reply_delay_minutes;
  const minutes = delay.min + (createHash("sha256").update(`${a.id}:${event.id}`).digest().readUInt32BE(0) % Math.max(1, delay.max - delay.min + 1));
  const task = await repo.createTask({
    type: "approve_reply",
    title: `Approve a persona reply: ${clinic.name}`,
    testId: a.testId,
    assignmentId: a.id,
    clinicId: clinic.id,
    inboundEventId: event.id,
    payload: {
      draft,
      draftedBy,
      to,
      subject: missedCall ? `Re: ${a.subject}` : /^re:/i.test(event.subject ?? "") ? event.subject : `Re: ${event.subject || a.subject}`,
      inReplyTo: missedCall ? null : event.externalId,
      missedCall,
    },
    dueAt: new Date(event.receivedAt.getTime() + minutes * 60_000),
  });
  await notifyOps(deps, task, [`Clinic: ${clinic.name}`, `Send after ${minutes} minutes, and within 4 hours.`]);
  return true;
}

/** A VA approved (and maybe edited) a reply: send it as the persona and close the task. */
export async function sendPersonaReply(deps: ShopperDeps, taskId: string, text: string, actor: string): Promise<Result> {
  const { repo, playbook } = deps;
  const problems = checkPersonaReply(text);
  if (problems.length) return { ok: false, status: 400, message: problems.join(" ") };
  const task = await repo.getTask(taskId);
  if (!task || task.type !== "approve_reply" || task.status !== "open" || !task.assignmentId) return { ok: false, status: 409, message: "This reply was already handled." };
  const a = (await repo.getAssignment(task.assignmentId))!;
  const test = (await repo.getTest(a.testId))!;
  if (test.status !== "running") return { ok: false, status: 409, message: "The test isn't running any more." };
  const max = playbook.personaRules.scripts[a.script].max_replies;
  if (a.repliesSent >= max) return { ok: false, status: 409, message: "This persona has already replied." };
  // Closing the task first makes a double click harmless.
  const now = deps.now();
  if (!(await repo.completeTask(task.id, { by: actor, resolution: "sent", at: now }))) return { ok: false, status: 409, message: "This reply was already handled." };

  const p = task.payload as { to: string; subject: string; inReplyTo: string | null };
  const messageId = `<${randomUUID()}@${a.email.split("@")[1]}>`;
  const headers: Record<string, string> = { "Message-ID": messageId };
  if (p.inReplyTo) {
    headers["In-Reply-To"] = p.inReplyTo;
    headers.References = p.inReplyTo;
  }
  try {
    await deps.sendEmail({ from: `${a.firstName} ${a.lastName} <${a.email}>`, to: p.to, replyTo: null, subject: p.subject, text: text.trim(), headers });
  } catch (err) {
    await repo.createTask({ type: "approve_reply", title: task.title, testId: task.testId, assignmentId: a.id, clinicId: task.clinicId, inboundEventId: task.inboundEventId, payload: { ...task.payload, draft: text, error: (err as Error).message }, dueAt: task.dueAt });
    return { ok: false, status: 502, message: "The email didn't send. The task is back in the queue." };
  }
  await repo.recordPersonaReply(a.id, { at: now, messageId, maxReplies: max });
  await repo.insertOutbound({ assignmentId: a.id, kind: "follow_up", channel: "email", subject: p.subject, body: text.trim(), target: p.to, messageId, sentAt: now, sentBy: actor });
  await repo.audit(actor, "persona.replied", { type: "assignment", id: a.id }, { taskId: task.id });
  return { ok: true };
}
