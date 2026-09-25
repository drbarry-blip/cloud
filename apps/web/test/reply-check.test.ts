import { describe, expect, it } from "vitest";
import type { AiReview, AiReviewer } from "@/lib/ai";
import { getPlaybook } from "@/lib/playbook";
import { runReplyCheck } from "@/lib/reply-check";

const playbook = getPlaybook();
const unsafeReply = "Hi Jane, we're sorry your Botox results weren't what you hoped.";

function fakeReviewer(review: AiReview): { reviewer: AiReviewer; calls: number } {
  const state = { calls: 0, reviewer: (async () => {
    state.calls++;
    return review;
  }) as AiReviewer };
  return state;
}

describe("runReplyCheck", () => {
  it("works rules-only and locks rewrites until an email is given", async () => {
    const r = await runReplyCheck({ reply: unsafeReply, clinicTypeId: "med_spa", includeRewrites: false }, playbook, null);
    expect(r.mode).toBe("rules_only");
    expect(r.verdict).toBe("unsafe");
    expect(r.rewrites).toBeNull();
    expect(r.rewritesLocked).toBe(true);
  });

  it("returns safe template rewrites in rules-only mode", async () => {
    const r = await runReplyCheck(
      { reply: unsafeReply, review: "Terrible results, very disappointed.", clinicTypeId: "med_spa", contact: { role: "Maria", phone: "555-0100" }, includeRewrites: true },
      playbook,
      null,
    );
    expect(r.rewrites!.length).toBeGreaterThan(0);
    for (const rw of r.rewrites!) {
      expect(rw.source).toBe("template");
      expect(rw.text).toContain("555-0100");
    }
  });

  it("merges AI flags, but drops quotes that aren't really in the reply", async () => {
    const { reviewer } = fakeReviewer({
      scenario: "negative_outcome_or_staff",
      flags: [
        { quote: "weren't what you hoped", category: "treatment_details", severity: "unsafe", reason: "Refers to their results." },
        { quote: "this text is not in the reply", category: "confirms_patient", severity: "unsafe", reason: "Hallucinated." },
      ],
      rewrites: { short_warm: "Thank you for sharing this. Please call our office manager at 555-0100.", service_recovery: "x", grateful_no_confirm: "y" },
    });
    const r = await runReplyCheck({ reply: unsafeReply, includeRewrites: false }, playbook, reviewer);
    expect(r.mode).toBe("ai");
    expect(r.flags.some((f) => f.source === "ai" && f.match === "weren't what you hoped")).toBe(true);
    expect(r.flags.some((f) => f.reason === "Hallucinated.")).toBe(false);
  });

  it("replaces any AI rewrite that fails the rules with a vetted template", async () => {
    const { reviewer } = fakeReviewer({
      scenario: "negative_general",
      flags: [],
      rewrites: {
        short_warm: "Thanks for the feedback. We'd love to talk. Please call our office manager at 555-0100.",
        service_recovery: "Sorry about your appointment, Jane. Call us!", // unsafe: confirms patient + name
        grateful_no_confirm: "Thank you for taking the time to share this with us. Please call our office manager at 555-0100.",
      },
    });
    const r = await runReplyCheck({ reply: "We're sorry. Please call us.", includeRewrites: true, contact: { phone: "555-0100" } }, playbook, reviewer);
    const recovery = r.rewrites!.find((w) => w.text.includes("appointment"));
    expect(recovery).toBeUndefined();
    expect(r.rewrites!.some((w) => w.source === "template")).toBe(true);
    expect(r.rewrites!.some((w) => w.source === "ai")).toBe(true);
  });

  it("falls back to rules-only when the AI returns nothing", async () => {
    const r = await runReplyCheck({ reply: unsafeReply, includeRewrites: false }, playbook, async () => null);
    expect(r.mode).toBe("rules_only");
    expect(r.verdict).toBe("unsafe");
  });
});
