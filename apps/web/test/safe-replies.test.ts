import { checkReplyRules } from "@cgs/core";
import { describe, expect, it } from "vitest";
import { getPlaybook } from "@/lib/playbook";
import { allSafeReplyParams, getSafeReplyPage } from "@/lib/safe-replies";

describe("safe reply library", () => {
  const params = allSafeReplyParams();

  it("has a page for every clinic type and situation", () => {
    expect(params).toHaveLength(4 * 6);
  });

  it.each(params)("$clinicType / $scenario: template is safe and the bad example is flagged unsafe", ({ clinicType, scenario }) => {
    const page = getSafeReplyPage(clinicType, scenario)!;
    const rules = getPlaybook().reviewReplyRules;
    expect(checkReplyRules(page.template, rules, page.clinicType.reply_checker_terms).verdict).toBe("safe");
    expect(checkReplyRules(page.avoid, rules, page.clinicType.reply_checker_terms).verdict).toBe("unsafe");
  });

  it("returns null for unknown pages", () => {
    expect(getSafeReplyPage("nope", "negative-review")).toBeNull();
  });
});
