import { describe, expect, it } from "vitest";
import { checkReplyRules, guessScenario, safeTemplate, SAFE_TEMPLATE_IDS } from "../src";
import { allClinicTerms, playbook } from "./helpers";

const rules = playbook.reviewReplyRules;
const check = (reply: string, terms: readonly string[] = allClinicTerms) => checkReplyRules(reply, rules, terms);
const categories = (reply: string) => check(reply).flags.map((f) => f.category);

describe("checkReplyRules", () => {
  it("passes every safe fallback template", () => {
    for (const id of SAFE_TEMPLATE_IDS) {
      const text = safeTemplate(rules, id, { role: "our office manager", phone: "(555) 123-4567" });
      expect(check(text), `${id}: ${text}`).toEqual({ verdict: "safe", flags: [] });
    }
  });

  it("flags a reply that confirms the patient, names a treatment, and gives a date", () => {
    const result = check("Hi Jane, we're sorry your Botox results weren't what you hoped. Our records show you were seen on March 3.");
    expect(result.verdict).toBe("unsafe");
    expect(result.flags.map((f) => f.category)).toEqual(
      expect.arrayContaining(["identifiers", "treatment_details", "confirms_patient"]),
    );
    // The name alone is a caution, but it's upgraded because other flags are present.
    expect(result.flags.find((f) => f.match === "Jane")?.severity).toBe("unsafe");
  });

  it("treats a name on its own as a caution", () => {
    expect(check("Thank you, Jane! We appreciate you taking the time to share.")).toMatchObject({
      verdict: "needs_changes",
      flags: [{ category: "identifiers", match: "Jane", severity: "caution" }],
    });
  });

  it("catches a name addressed at the end of a sentence", () => {
    expect(check("Thanks so much for the kind words, Jane!")).toMatchObject({
      verdict: "needs_changes",
      flags: [{ category: "identifiers", match: "Jane" }],
    });
  });

  it("allows naming the clinic's own contact person", () => {
    expect(check("We'd love to hear more. Please call our office manager, Maria.").verdict).toBe("safe");
  });

  it("allows kind replies with no details", () => {
    expect(check("Thanks so much for the kind words! Our team loves hearing this.").verdict).toBe("safe");
  });

  it("cautions on a treatment term that isn't tied to the reader", () => {
    const result = check("We offer Botox and fillers at our clinic.");
    expect(result.verdict).toBe("needs_changes");
    expect(result.flags.every((f) => f.severity === "caution")).toBe(true);
  });

  it("marks a treatment term near 'you' or 'your' as unsafe", () => {
    expect(check("We hope your filler settles in nicely!").verdict).toBe("unsafe");
  });

  it("ignores a provider's name in the sign-off", () => {
    const reply = "Thank you for sharing. Please call our office manager at 555-123-4567.\n- Dr. Smith, Owner";
    expect(check(reply).verdict).toBe("safe");
  });

  it("flags a provider named in the body", () => {
    expect(categories("Dr. Patel is one of our most careful providers.")).toContain("identifiers");
  });

  it("flags dates, days, and times", () => {
    expect(check("We looked into what happened last Tuesday at 3:30 pm.").flags.filter((f) => f.category === "identifiers")).toHaveLength(2);
  });

  it("flags 'we have no record of you' because denying is also a disclosure", () => {
    expect(check("We have no record of you as a customer.").verdict).toBe("unsafe");
  });

  it("flags billing details and arguing about care", () => {
    expect(categories("Your balance was sent to collections because you signed the policy.")).toEqual(
      expect.arrayContaining(["billing_insurance", "arguing_care"]),
    );
  });

  it("cautions on defensive tone, including curly apostrophes", () => {
    const result = check("That’s not true. Please call our office at 555-123-4567.");
    expect(result).toMatchObject({ verdict: "needs_changes", flags: [{ category: "tone" }] });
  });

  it("cautions when an apology has no way to reach the office", () => {
    expect(categories("We're sorry to hear about this experience.")).toEqual(["no_private_path"]);
    expect(check("We're sorry to hear this. Please call our office manager.").verdict).toBe("safe");
  });

  it("returns flags in text order with correct offsets", () => {
    const reply = "Hi Jane, your appointment ran late.";
    const { flags } = check(reply);
    for (const f of flags) expect(reply.slice(f.start, f.end)).toBe(f.match);
    expect(flags.map((f) => f.start)).toEqual([...flags.map((f) => f.start)].sort((a, b) => a - b));
  });
});

describe("guessScenario", () => {
  it("routes wait-time complaints", () => {
    expect(guessScenario("Waited an hour past my appointment. So frustrating.", "")).toBe("negative_wait_time");
  });
  it("routes price complaints", () => {
    expect(guessScenario("Way too expensive and the bill was a surprise. Disappointed.", "")).toBe("negative_price");
  });
  it("routes praise", () => {
    expect(guessScenario("Amazing staff, love this place!", "")).toBe("positive_general");
  });
  it("falls back to the reply when there's no review", () => {
    expect(guessScenario(undefined, "We're sorry to hear this.")).toBe("negative_general");
  });
});
