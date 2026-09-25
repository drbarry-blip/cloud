import "server-only";
import {
  checkReplyRules,
  dedupe,
  finalize,
  guessScenario,
  safeTemplate,
  type Playbook,
  type ReplyFlag,
  type SafeTemplateId,
  type Verdict,
} from "@cgs/core";
import type { AiReview, AiReviewer } from "./ai";

export interface ReplyCheckRequest {
  reply: string;
  review?: string;
  clinicTypeId?: string;
  contact?: { role?: string; phone?: string };
  includeRewrites: boolean;
}

export interface Rewrite {
  id: string;
  label: string;
  text: string;
  source: "ai" | "template";
}

export interface ReplyCheckResponse {
  verdict: Verdict;
  flags: ReplyFlag[];
  mode: "ai" | "rules_only";
  scenario: SafeTemplateId;
  rewrites: Rewrite[] | null;
  rewritesLocked: boolean;
}

const POSITIVE = new Set<SafeTemplateId>(["positive_general"]);

/** Finds an AI quote in the reply; AI flags whose quotes aren't really there are dropped. */
function locate(reply: string, quote: string): { start: number; end: number } | null {
  const q = quote.trim();
  if (!q) return null;
  let i = reply.indexOf(q);
  if (i === -1) i = reply.toLowerCase().indexOf(q.toLowerCase());
  return i === -1 ? null : { start: i, end: i + q.length };
}

function aiFlags(reply: string, ai: AiReview): ReplyFlag[] {
  return ai.flags.flatMap((f) => {
    const pos = locate(reply, f.quote);
    if (!pos) return [];
    return [{ category: f.category, severity: f.severity, match: reply.slice(pos.start, pos.end), ...pos, reason: f.reason, source: "ai" as const }];
  });
}

export async function runReplyCheck(req: ReplyCheckRequest, playbook: Playbook, reviewer: AiReviewer | null): Promise<ReplyCheckResponse> {
  const rules = playbook.reviewReplyRules;
  const clinicType = req.clinicTypeId ? playbook.clinicTypes[req.clinicTypeId] : undefined;
  const terms = clinicType
    ? clinicType.reply_checker_terms
    : [...new Set(Object.values(playbook.clinicTypes).flatMap((c) => c.reply_checker_terms))];
  const contact = { role: req.contact?.role?.trim() || "our office manager", phone: req.contact?.phone?.trim() || "our main number" };

  const ruleResult = checkReplyRules(req.reply, rules, terms);
  const ai = reviewer
    ? await reviewer(
        { reply: req.reply, review: req.review, clinicTypeName: clinicType?.name, treatmentTerms: terms, contact, ruleFlags: ruleResult.flags },
        rules,
      )
    : null;

  const merged = ai ? finalize(dedupe([...ruleResult.flags, ...aiFlags(req.reply, ai)])) : ruleResult;
  const scenario = ai?.scenario ?? guessScenario(req.review, req.reply);

  let rewrites: Rewrite[] | null = null;
  if (req.includeRewrites) {
    const template = (id: SafeTemplateId, label: string): Rewrite => ({ id, label, text: safeTemplate(rules, id, contact), source: "template" });
    const fallbackFor = (slot: keyof AiReview["rewrites"]): Rewrite => {
      if (slot === "grateful_no_confirm") return template(POSITIVE.has(scenario) ? "positive_general" : "mixed_or_neutral", "Safe template");
      if (slot === "service_recovery" && POSITIVE.has(scenario)) return template("mixed_or_neutral", "Safe template");
      return template(scenario, "Safe template");
    };
    const candidates: Rewrite[] = ai
      ? (
          [
            ["short_warm", "Short and warm"],
            ["service_recovery", "Invite them to call"],
            ["grateful_no_confirm", "Gracious, confirms nothing"],
          ] as const
        ).map(([slot, label]) => {
          const text = ai.rewrites[slot].trim();
          // Every AI rewrite must pass the rules on its own, or it's replaced by a vetted template.
          return text && checkReplyRules(text, rules, terms).verdict === "safe"
            ? { id: slot, label, text, source: "ai" as const }
            : fallbackFor(slot);
        })
      : POSITIVE.has(scenario)
        ? [template("positive_general", "Safe template")]
        : [template(scenario, "Safe template"), template("negative_general", "Safe template (general)")];
    rewrites = candidates.filter((r, i, all) => all.findIndex((o) => o.text === r.text) === i);
  }

  return {
    verdict: merged.verdict,
    flags: merged.flags,
    mode: ai ? "ai" : "rules_only",
    scenario,
    rewrites,
    rewritesLocked: !req.includeRewrites,
  };
}
