import "server-only";
import { checkReplyRules, safeTemplate, SAFE_TEMPLATE_IDS, type ClinicType, type ReplyFlag, type SafeTemplateId } from "@cgs/core";
import { getPlaybook } from "./playbook";

// Static "safe reply" library pages: one per clinic type and review situation.
// The "replies to avoid" are run through the real checker, so the library and the
// tool never disagree.

export const SCENARIO_COPY: Record<SafeTemplateId, { slug: string; title: string; situation: string; avoid: string }> = {
  negative_general: {
    slug: "negative-review",
    title: "a negative review",
    situation: "Someone had a bad experience and said so publicly.",
    avoid: "Hi {name}, we're sorry your {service} visit last week didn't meet your expectations. Our records show we called you twice afterward.",
  },
  negative_wait_time: {
    slug: "wait-time-complaint",
    title: "a complaint about wait times",
    situation: "The reviewer says they waited too long or their appointment started late.",
    avoid: "We're sorry you waited 40 minutes at your {service} appointment on Tuesday. Your provider was running behind that morning.",
  },
  negative_price: {
    slug: "price-complaint",
    title: "a complaint about price or billing",
    situation: "The reviewer thinks they were overcharged or surprised by a bill.",
    avoid: "Your {service} invoice matched the quote you signed, and your balance reflects what your insurance didn't cover.",
  },
  negative_outcome_or_staff: {
    slug: "results-or-staff-complaint",
    title: "a complaint about results or staff",
    situation: "The reviewer is unhappy with their results or how a staff member treated them.",
    avoid: "Dr. Lee reviewed your chart, and the {service} results you describe are normal. You were told about this at your consultation.",
  },
  positive_general: {
    slug: "positive-review",
    title: "a positive review",
    situation: "A happy reviewer left kind words. Even thank-yous can reveal too much.",
    avoid: "Thanks, {name}! So glad your {service} results turned out great. See you at your follow-up next month!",
  },
  mixed_or_neutral: {
    slug: "mixed-review",
    title: "a mixed review",
    situation: "The reviewer liked some things and not others.",
    avoid: "Thanks for the feedback, {name}. We're glad your {service} went well, even though your appointment started late.",
  },
};

const CLINIC_SLUGS: Record<string, string> = {
  med_spa: "med-spa",
  hormone_weight_loss: "hormone-weight-loss",
  dental: "dental",
  chiro_pt_wellness: "chiropractic-pt-wellness",
};

export function clinicSlug(id: string) {
  return CLINIC_SLUGS[id] ?? id.replace(/_/g, "-");
}

/** "Botox / neurotoxin" -> "Botox" (brand kept as written); "Testosterone replacement therapy" -> lowercase. */
function serviceShortName(c: ClinicType): string {
  const name = c.services[0]!.name;
  const first = name.split(/\s*[/(]/)[0]!.trim();
  return name.includes("/") ? first : first.charAt(0).toLowerCase() + first.slice(1);
}

export interface SafeReplyPage {
  clinicType: ClinicType;
  clinicSlug: string;
  scenarioId: SafeTemplateId;
  scenarioSlug: string;
  title: string;
  situation: string;
  template: string;
  templateWhy: string;
  avoid: string;
  avoidFlags: ReplyFlag[];
  rewriteRules: string[];
}

export function allSafeReplyParams(): { clinicType: string; scenario: string }[] {
  return Object.values(getPlaybook().clinicTypes).flatMap((c) =>
    SAFE_TEMPLATE_IDS.map((id) => ({ clinicType: clinicSlug(c.id), scenario: SCENARIO_COPY[id].slug })),
  );
}

export function getSafeReplyPage(clinicTypeSlug: string, scenarioSlug: string): SafeReplyPage | null {
  const playbook = getPlaybook();
  const clinicType = Object.values(playbook.clinicTypes).find((c) => clinicSlug(c.id) === clinicTypeSlug);
  const scenarioId = SAFE_TEMPLATE_IDS.find((id) => SCENARIO_COPY[id].slug === scenarioSlug);
  if (!clinicType || !scenarioId) return null;
  const copy = SCENARIO_COPY[scenarioId];
  const avoid = copy.avoid.replace("{name}", "Jane").replace("{service}", serviceShortName(clinicType));
  return {
    clinicType,
    clinicSlug: clinicTypeSlug,
    scenarioId,
    scenarioSlug,
    title: `How to reply to ${copy.title}: ${clinicType.name}`,
    situation: copy.situation,
    template: safeTemplate(playbook.reviewReplyRules, scenarioId, { role: "our office manager", phone: "[your office number]" }),
    templateWhy:
      scenarioId === "positive_general"
        ? "It thanks the reviewer warmly without confirming they're a patient or mentioning their care."
        : "It thanks the reviewer, shows you take feedback seriously, and moves the conversation offline without confirming anything about them.",
    avoid,
    avoidFlags: checkReplyRules(avoid, playbook.reviewReplyRules, clinicType.reply_checker_terms).flags,
    // Reader-facing rules only; "offer three versions" is an instruction for the AI rewriter.
    rewriteRules: playbook.reviewReplyRules.rewrite_rules.filter((r) => !/\bversions\b/i.test(r)),
  };
}
