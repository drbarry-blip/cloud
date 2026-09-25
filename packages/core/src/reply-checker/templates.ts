import type { ReviewReplyRules, SafeTemplateId } from "../playbook/schema";

export const SAFE_TEMPLATE_IDS = [
  "negative_general",
  "negative_wait_time",
  "negative_price",
  "negative_outcome_or_staff",
  "positive_general",
  "mixed_or_neutral",
] as const satisfies readonly SafeTemplateId[];

export interface ContactDetails {
  /** Who reviewers should ask for, e.g. "our office manager". */
  role?: string;
  /** Office phone number shown in the template. */
  phone?: string;
}

export function fillTemplate(template: string, contact: ContactDetails = {}): string {
  const role = contact.role?.trim() || "our office manager";
  const phone = contact.phone?.trim() || "our main number";
  return template.replace(/\{role\}/g, role).replace(/\{phone\}/g, phone).replace(/\s+/g, " ").trim();
}

export function safeTemplate(rules: ReviewReplyRules, id: SafeTemplateId, contact?: ContactDetails): string {
  return fillTemplate(rules.safe_templates[id], contact);
}

const POSITIVE = /\b(?:thank(?:s| you)|glad|appreciate|wonderful|great|amazing|love|happy|kind words)\b/i;
// Word stems: no trailing \b, so "frustrat" matches "frustrating" and "wait" matches "waited".
const NEGATIVE = /\b(?:sorry|apologi|disappoint|frustrat|concern|unfortunately|regret|upset|terrible|awful|worst)/i;
const WAIT = /\b(?:wait|late|delay|on time|schedul)/i;
const PRICE = /\b(?:pric|cost|expensive|bill|charg|fee|money|overcharg)/i;
const OUTCOME = /\b(?:rude|staff|result|outcome|pain|hurt|botch|mistake|unprofessional)/i;

/**
 * Picks a fallback template from the review (preferred) and reply text when no
 * AI classification is available. Deliberately simple; errs toward "general".
 */
export function guessScenario(review: string | undefined, reply: string): SafeTemplateId {
  const text = `${review ?? ""} ${reply}`;
  const negative = NEGATIVE.test(text) || /\b(?:1|one|2|two)[- ]star/i.test(text);
  const positive = POSITIVE.test(review ?? reply);
  if (negative && !positive) {
    if (WAIT.test(text)) return "negative_wait_time";
    if (PRICE.test(text)) return "negative_price";
    if (OUTCOME.test(text)) return "negative_outcome_or_staff";
    return "negative_general";
  }
  if (negative && positive) return "mixed_or_neutral";
  if (positive) return "positive_general";
  return "mixed_or_neutral";
}
