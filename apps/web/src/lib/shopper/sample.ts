import "server-only";
import { config } from "../config";
import { createLiteDb } from "../db";
import { getPlaybook } from "../playbook";
import { SqlStore } from "../store/sql";
import { seedDemoTest } from "./demo";
import type { ShopperDeps } from "./deps";
import { reviveReport, type ReportData } from "./grade";
import { ShopperRepo, type TestKind } from "./repo";
import { testDates } from "./schedule";

export interface SampleReport {
  report: ReportData;
  kind: TestKind;
  dates: string | null;
  headline: string;
}

const shared = globalThis as typeof globalThis & { __cgsSample?: Promise<SampleReport> };

/**
 * The public sample report (SPEC.md §6.6): a fictional clinic's complete test, run
 * through the real engine and grader on a throwaway in-memory database, once per
 * server process. Nothing touches the real database, and nothing is sent.
 */
export function sampleReport(): Promise<SampleReport> {
  shared.__cgsSample ??= (async () => {
    const db = await createLiteDb();
    const deps: ShopperDeps = {
      repo: new ShopperRepo(db),
      store: new SqlStore(db),
      playbook: getPlaybook(),
      now: () => new Date(),
      sendEmail: async () => ({ id: null }),
      stripe: null,
      personaDomains: () => ["personas.example.net"],
      siteUrl: config.siteUrl(),
      allowSimulatedCheckout: true,
      opsEmail: null,
      notifyOps: false,
      formBot: null,
      aiJudge: null,
      aiDraft: null,
    };
    const { testId } = await seedDemoTest(deps, { suffix: "sample" });
    const test = (await deps.repo.getTest(testId))!;
    const clinic = (await deps.repo.getClinic(test.clinicId))!;
    const report = reviveReport(test.result)!;
    await db.close();
    return { report, kind: test.kind, dates: testDates(test, clinic), headline: report.grade.headline };
  })().catch((err) => {
    shared.__cgsSample = undefined;
    throw err;
  });
  return shared.__cgsSample;
}
