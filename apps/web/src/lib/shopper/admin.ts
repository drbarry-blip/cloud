import "server-only";
import { classifyTouch } from "@cgs/core";
import { z } from "zod";
import type { Staff } from "../auth";
import { trySend, type ShopperDeps } from "./deps";
import { phiNoticeEmail } from "./emails";
import { markInquirySent } from "./engine";
import { gradeAndQueueQa, gradeShopperTest } from "./grade";
import { queuePersonaReply, sendPersonaReply } from "./persona-reply";
import { refundOrder, rejectVerification, verifyClinic, type Result } from "./purchase";
import type { OpsTask, TaskType } from "./repo";
import { deliverReport } from "./report";

// What VAs and admins can do from the console (SPEC.md §6.4). Every action is
// checked against the task's type and the person's role, and written to the audit log.

export const TaskActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("verify") }),
  z.object({ action: z.literal("reject"), reason: z.string().trim().min(3).max(500) }),
  z.object({ action: z.literal("form_submitted"), confirmation: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal("form_broken"), note: z.string().trim().min(3).max(500) }),
  z.object({ action: z.literal("retry") }),
  z.object({ action: z.literal("send_reply"), text: z.string().max(2000) }),
  z.object({ action: z.literal("match"), assignmentId: z.uuid() }),
  z.object({ action: z.literal("phi_confirmed") }),
  z.object({ action: z.literal("phi_false_alarm") }),
  z.object({ action: z.literal("approve_report"), headline: z.string().trim().max(300).nullish(), notes: z.string().trim().max(2000).nullish() }),
  z.object({ action: z.literal("regrade") }),
  z.object({ action: z.literal("resolve"), note: z.string().trim().min(1).max(1000) }),
]);
export type TaskAction = z.infer<typeof TaskActionSchema> & { minutesSpent?: number };

/** Which actions fit which task types. */
const ALLOWED: Record<TaskType, TaskAction["action"][]> = {
  verify_ownership: ["verify", "reject", "resolve"],
  submit_form: ["form_submitted", "form_broken", "retry", "resolve"],
  fix_failure: ["retry", "form_broken", "resolve"],
  approve_reply: ["send_reply", "resolve"],
  match_inbound: ["match", "resolve"],
  review_phi: ["phi_confirmed", "phi_false_alarm"],
  qa_report: ["approve_report", "regrade", "resolve"],
};
/** Refunds and anything touching possible PHI need an admin (SPEC.md §6.2, §9.1). */
const ADMIN_ONLY: TaskAction["action"][] = ["reject", "phi_confirmed", "phi_false_alarm"];
/** Task types VAs don't see at all. */
export const ADMIN_ONLY_TASKS: TaskType[] = ["review_phi"];

export const canSeeTask = (staff: Staff, task: Pick<OpsTask, "type">) => staff.role === "admin" || !ADMIN_ONLY_TASKS.includes(task.type);

export async function runTaskAction(deps: ShopperDeps, staff: Staff, taskId: string, input: TaskAction): Promise<Result> {
  const { repo } = deps;
  const task = await repo.getTask(taskId);
  if (!task || !canSeeTask(staff, task)) return { ok: false, status: 404, message: "Task not found." };
  if (task.status !== "open") return { ok: false, status: 409, message: "This task is already closed." };
  if (!ALLOWED[task.type].includes(input.action)) return { ok: false, status: 400, message: "That action doesn't apply to this task." };
  if (ADMIN_ONLY.includes(input.action) && staff.role !== "admin") return { ok: false, status: 403, message: "Only an admin can do that." };

  const actor = `email:${staff.email}`;
  const now = deps.now();
  const close = async (resolution: string) => {
    await repo.completeTask(task.id, { by: staff.email, minutesSpent: input.minutesSpent ?? null, resolution, at: now });
    await repo.audit(actor, `task.${input.action}`, { type: "task", id: task.id }, { taskType: task.type });
  };
  const assignment = task.assignmentId ? await repo.getAssignment(task.assignmentId) : null;

  switch (input.action) {
    case "verify":
      await close("Verified by hand");
      await verifyClinic(deps, task.clinicId!, "manual", actor);
      return { ok: true };

    case "reject":
      await close(`Rejected: ${input.reason}`);
      await rejectVerification(deps, task.clinicId!, actor, input.reason);
      return { ok: true };

    case "form_submitted": {
      if (!assignment || !(await repo.claimAssignment(assignment.id, ["needs_va", "sending"]))) {
        return { ok: false, status: 409, message: "This inquiry isn't waiting to be sent." };
      }
      await markInquirySent(deps, assignment, {
        sentAt: now,
        sentBy: `va:${staff.email}`,
        channel: "web_form",
        target: assignment.target,
        evidence: { confirmation: input.confirmation ?? null },
      });
      await close("Submitted by hand");
      return { ok: true };
    }

    case "form_broken": {
      if (!assignment) return { ok: false, status: 400, message: "No inquiry on this task." };
      const test = (await repo.getTest(assignment.testId))!;
      const clinic = (await repo.getClinic(test.clinicId))!;
      await repo.addFinding(test.id, { kind: "form_broken", text: `The contact form at ${assignment.target} didn't work: ${input.note}`, at: now.toISOString(), assignmentId: assignment.id });
      // A broken form is a finding; the persona still reaches out, by email (SPEC.md §7.1).
      if (clinic.publicEmail) {
        await repo.switchChannel(assignment.id, "email", clinic.publicEmail);
        await repo.rescheduleAssignment(assignment.id, now);
      } else {
        await repo.setSendStatus(assignment.id, "failed");
      }
      await close(clinic.publicEmail ? "Form broken; switched to email" : "Form broken; no email to fall back on");
      return { ok: true };
    }

    case "retry": {
      if (!assignment || !(await repo.rescheduleAssignment(assignment.id, now))) return { ok: false, status: 409, message: "This inquiry can't be retried." };
      await close("Retrying");
      return { ok: true };
    }

    case "send_reply": {
      const res = await sendPersonaReply(deps, task.id, input.text, `va:${staff.email}`);
      if (res.ok) await repo.audit(actor, "task.send_reply", { type: "task", id: task.id }, {});
      return res;
    }

    case "match": {
      const target = await repo.getAssignment(input.assignmentId);
      if (!target || !task.inboundEventId) return { ok: false, status: 400, message: "Pick a persona." };
      const event = (await repo.getInbound(task.inboundEventId))!;
      const late = Boolean(target.observeUntil && event.receivedAt > target.observeUntil);
      await repo.attachInbound(event.id, target.id, late);
      const labeled = (await repo.setInboundLabel(event.id, classifyTouch({ channel: event.channel, subject: event.subject ?? undefined, text: event.body ?? undefined, headers: event.headers }), "va"))!;
      await close("Matched");
      await queuePersonaReply(deps, (await repo.getAssignment(target.id))!, labeled);
      return { ok: true };
    }

    case "phi_confirmed": {
      if (task.inboundEventId) await repo.purgeInbound(task.inboundEventId);
      const clinic = task.clinicId ? await repo.getClinic(task.clinicId) : null;
      const lead = clinic ? await deps.store.getLead(clinic.ownerLeadId) : null;
      if (clinic && lead) await trySend(deps, { ...phiNoticeEmail({ clinicName: clinic.name }), to: lead.email }, "PHI notice");
      await close("Confirmed; content deleted and customer told");
      await repo.audit(actor, "phi.deleted", { type: "inbound_event", id: task.inboundEventId ?? "" }, {});
      return { ok: true };
    }

    case "phi_false_alarm": {
      if (!task.inboundEventId) return { ok: false, status: 400, message: "No message on this task." };
      const event = (await repo.setPhiQuarantine(task.inboundEventId, false))!;
      await close("False alarm; released");
      if (event.assignmentId) await queuePersonaReply(deps, (await repo.getAssignment(event.assignmentId))!, event);
      return { ok: true };
    }

    case "approve_report": {
      if ((await repo.getTest(task.testId!))?.status !== "qa") return { ok: false, status: 409, message: "This report isn't waiting for QA." };
      await close("Approved and sent");
      const res = await deliverReport(deps, task.testId!, actor, { headlineOverride: input.headline, qaNotes: input.notes });
      return res;
    }

    case "regrade":
      await gradeShopperTest(deps, task.testId!);
      await repo.audit(actor, "test.regraded", { type: "test", id: task.testId! }, {});
      return { ok: true };

    case "resolve":
      await close(input.note);
      return { ok: true };
  }
}

/** Staff correct a touch's label (e.g. an auto-reply the rules took for a person). */
export async function relabelTouch(deps: ShopperDeps, staff: Staff, eventId: string, label: "personal" | "auto_reply" | "marketing" | "reminder"): Promise<Result> {
  const event = await deps.repo.getInbound(eventId);
  if (!event) return { ok: false, status: 404, message: "Message not found." };
  if (event.phiQuarantined && staff.role !== "admin") return { ok: false, status: 403, message: "Only an admin can change that message." };
  await deps.repo.setInboundLabel(eventId, label, "va");
  await deps.repo.audit(`email:${staff.email}`, "touch.relabeled", { type: "inbound_event", id: eventId }, { label });
  return { ok: true };
}

/**
 * Stops a test (e.g. the owner cancels mid-test, SPEC.md §7.1): unsent inquiries are
 * cancelled, open tasks closed, numbers quarantined, and the order optionally refunded.
 * A test that already sent inquiries goes to grading, so the owner still gets a
 * partial report.
 */
export async function cancelTest(deps: ShopperDeps, staff: Staff, testId: string, refund: "full" | "none"): Promise<Result> {
  if (staff.role !== "admin") return { ok: false, status: 403, message: "Only an admin can cancel a test." };
  const { repo, playbook } = deps;
  const test = await repo.getTest(testId);
  if (!test) return { ok: false, status: 404, message: "Test not found." };
  const now = deps.now();
  const actor = `email:${staff.email}`;
  const assignments = await repo.assignmentsForTest(testId);
  const anySent = assignments.some((a) => a.sendStatus === "sent");
  const target = anySent && test.status === "running" ? "grading" : "cancelled";
  const moved = await repo.transitionTest(testId, ["awaiting_payment", "awaiting_verification", "scheduled", "running"], target, "Cancelled");
  if (!moved) return { ok: false, status: 409, message: "This test can't be cancelled now." };
  await repo.cancelUnsent(testId);
  await repo.cancelOpenTasks({ testId, type: "submit_form" }, now, "Test cancelled");
  await repo.cancelOpenTasks({ testId, type: "approve_reply" }, now, "Test cancelled");
  await repo.releaseNumbers(testId, new Date(now.getTime() + playbook.personaRules.timing.number_quarantine_days * 86_400_000));
  await repo.audit(actor, "test.cancelled", { type: "test", id: testId }, { refund, partialReport: target === "grading" });
  if (refund === "full" && test.orderId) {
    const order = await repo.getOrder(test.orderId);
    if (order) await refundOrder(deps, order, actor);
  }
  if (target === "grading") await gradeAndQueueQa(deps, testId);
  return { ok: true };
}
