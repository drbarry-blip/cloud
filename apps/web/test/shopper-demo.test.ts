import { afterEach, describe, expect, it, vi } from "vitest";
import { seedDemoTest } from "@/lib/shopper/demo";
import { reviveReport } from "@/lib/shopper/grade";
import { makeDeps } from "./shopper-helpers";

afterEach(() => vi.restoreAllMocks());

describe("demo test", () => {
  it("runs a whole fictional test through the real code and lands in QA with a full report", async () => {
    const { deps, repo, sent } = await makeDeps();
    const { testId } = await seedDemoTest(deps, { suffix: "t1" });
    const test = (await repo.getTest(testId))!;
    expect(test.status).toBe("qa");
    const report = reviveReport(test.result)!;
    expect(report.inquiriesDelivered).toBe(3);
    const touches = report.timeline.map((t) => t.touches.map((x) => `${x.channel}:${x.label}`));
    expect(touches[0]).toEqual(["call:personal", "email:personal"]);
    expect(touches[1]).toEqual(["email:auto_reply", "email:personal", "email:personal"]);
    expect(touches[2]).toEqual(["email:personal", "email:personal", "sms:personal"]);
    expect(report.timeline[1]!.personaReplies).toHaveLength(1);
    expect(report.timeline[2]!.personaReplies).toHaveLength(1);
    expect(report.grade.grade).toMatch(/^[A-F]$/);
    expect(report.grade.fixes.length).toBeGreaterThan(0);
    // The demo never emails anyone.
    expect(sent).toEqual([]);
  });
});
