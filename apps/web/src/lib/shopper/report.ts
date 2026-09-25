import "server-only";
import { createToken } from "../tokens";
import { trySend, type ShopperDeps } from "./deps";
import { reportReadyEmail } from "./emails";
import { reviveReport } from "./grade";
import type { Result } from "./purchase";

export const reportUrl = (siteUrl: string, testId: string) => `${siteUrl}/report/${encodeURIComponent(createToken("report", testId))}`;

/** A score drop worth an alert (SPEC.md §7.1: 15+ points). */
export const SCORE_DROP_ALERT = 15;

/** QA passed: deliver the report to the buyer (SPEC.md §10.6 step 7). */
export async function deliverReport(deps: ShopperDeps, testId: string, actor: string, edits: { headlineOverride?: string | null; qaNotes?: string | null } = {}): Promise<Result> {
  const { repo } = deps;
  const test = await repo.getTest(testId);
  if (!test || test.status !== "qa") return { ok: false, status: 409, message: "This report isn't waiting for QA." };
  const report = reviveReport(test.result);
  if (!report) return { ok: false, status: 409, message: "This test hasn't been graded yet." };
  if (edits.headlineOverride !== undefined || edits.qaNotes !== undefined) {
    await repo.setQaEdits(testId, { headlineOverride: edits.headlineOverride?.trim() || null, qaNotes: edits.qaNotes?.trim() || null });
  }
  const previous = (await repo.deliveredTests(test.clinicId))[0] ?? null;
  const delivered = await repo.transitionTest(testId, ["qa"], "delivered", "Delivered");
  if (!delivered) return { ok: false, status: 409, message: "This report was already delivered." };
  await repo.cancelOpenTasks({ testId, type: "qa_report" }, deps.now(), `Delivered by ${actor}`);
  await repo.audit(actor, "report.delivered", { type: "test", id: testId }, { score: delivered.score, grade: delivered.grade });

  const clinic = (await repo.getClinic(test.clinicId))!;
  const lead = await deps.store.getLead(clinic.ownerLeadId);
  const hasRetests = (await repo.subscriptionsForClinic(clinic.id)).some((s) => s.status !== "canceled");
  const drop = previous?.score != null && delivered.score != null && previous.score - delivered.score >= SCORE_DROP_ALERT ? { from: previous.score, to: delivered.score } : null;
  if (lead) {
    await trySend(
      deps,
      {
        ...reportReadyEmail({
          clinicName: clinic.name,
          grade: delivered.grade ?? report.grade.grade,
          score: delivered.score ?? report.grade.total,
          headline: delivered.headlineOverride ?? report.grade.headline,
          reportUrl: reportUrl(deps.siteUrl, testId),
          kind: test.kind,
          scoreDrop: drop,
          retestUrl: hasRetests ? null : `${deps.siteUrl}/account`,
        }),
        to: lead.email,
      },
      "report ready",
    );
  }
  return { ok: true };
}
