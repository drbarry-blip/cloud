import type { ReviewReplyRules } from "../playbook/schema";

export type FlagSeverity = "unsafe" | "caution";
export type Verdict = "safe" | "needs_changes" | "unsafe";

export interface ReplyFlag {
  category: string;
  severity: FlagSeverity;
  /** The exact text from the reply that triggered the flag; empty when the flag is about something missing. */
  match: string;
  start: number;
  end: number;
  reason: string;
  source: "rules" | "ai";
}

export interface ReplyCheckResult {
  verdict: Verdict;
  flags: ReplyFlag[];
}

const SECOND_PERSON = /\byou(?:r|rs|'re|’re|'ve|’ve)?\b/i;
const TERM_WINDOW = 60;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Builds a case-insensitive, whole-phrase pattern tolerant of curly quotes and extra spaces. */
function phrasePattern(phrase: string): RegExp {
  const body = escapeRegExp(phrase.trim().toLowerCase())
    .replace(/'/g, "['’]")
    .replace(/\s+/g, "\\s+");
  const start = /^\w/.test(phrase.trim()) ? "\\b" : "";
  const end = /\w$/.test(phrase.trim()) ? "\\b" : "";
  return new RegExp(`${start}${body}${end}`, "gi");
}

function findAll(text: string, pattern: RegExp): { match: string; start: number; end: number }[] {
  const out: { match: string; start: number; end: number }[] = [];
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    out.push({ match: m[0], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

const NOT_NAMES = new Set([
  "There", "Everyone", "All", "Again", "So", "For", "You", "We", "Our", "The", "Team", "Friend", "Friends", "Folks",
]);
// Greeting words match either case; the name itself must be capitalized.
const SALUTATION_NAME = /\b(?:[Hh]i|[Hh]ello|[Hh]ey|[Dd]ear|[Tt]hanks|[Tt]hank you(?: so much)?|[Ww]elcome)[,!]?\s+([A-Z][a-z]{1,20})\b/g;
const TITLED_NAME = /\b(?:Mr|Mrs|Ms|Miss|Mx)\.?\s+[A-Z][a-z]{1,20}\b/g;
// A name addressed at the end of a sentence: "Thanks for the kind words, Jane!"
const VOCATIVE_NAME = /,\s*([A-Z][a-z]{1,20})\s*[!.?](?=\s|$)/g;
const STAFF_NAME = /\b(?:Dr|Doctor|Nurse|NP|PA|Hygienist|Therapist)\.?\s+[A-Z][a-z]{1,20}\b/g;
const DATES = [
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?\b/gi,
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g,
  /\b(?:on|last|this|next)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
  /\byesterday\b/gi,
];
const TIMES = /\b\d{1,2}(?::\d{2})?\s?(?:am|pm|a\.m\.|p\.m\.)(?=\W|$)/gi;
const APOLOGY = /\b(?:sorry|apologi[sz]e|apologies|concern|disappoint|frustrat|unfortunately|regret)/i;
const CONTACT_PATH = /\b(?:call|phone|contact|reach (?:out|us)|email|e-mail|message us|get in touch|speak with|talk with|talk directly)\b|\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}|@/i;

/** True when a match sits in a sign-off on the last line (e.g. "- Dr. Smith, Owner"), which is fine. */
function isSignOff(text: string, start: number, end: number): boolean {
  const lineEnd = text.indexOf("\n", end);
  if (lineEnd !== -1 && text.slice(lineEnd).trim().length > 0) return false; // not the last line
  const rest = text.slice(end, lineEnd === -1 ? text.length : lineEnd);
  if (rest.length > 40) return false; // more than a title follows, so it's a sentence
  const before = text.slice(Math.max(0, start - 30), start);
  return /(?:\n\s*|[-–—]\s*|(?:sincerely|best|warmly|regards|thanks|thank you),?\s*)$/i.test(before);
}

function explain(rules: ReviewReplyRules, category: string, fallback: string): string {
  return rules.categories[category]?.explain ?? fallback;
}

function baseSeverity(rules: ReviewReplyRules, category: string): FlagSeverity {
  return rules.categories[category]?.severity === "caution" ? "caution" : "unsafe";
}

/**
 * Deterministic first pass of the Review Reply Checker. It never sees or stores
 * anything beyond the text passed in, and runs identically with or without AI.
 */
export function checkReplyRules(
  reply: string,
  rules: ReviewReplyRules,
  clinicTerms: readonly string[] = [],
): ReplyCheckResult {
  const flags: ReplyFlag[] = [];
  const add = (category: string, severity: FlagSeverity, hit: { match: string; start: number; end: number }, reason: string) =>
    flags.push({ category, severity, ...hit, reason, source: "rules" });

  // 1. Phrase lists from the playbook (confirms_patient, treatment_details, billing, arguing care, tone...).
  for (const [category, def] of Object.entries(rules.categories)) {
    for (const phrase of def.phrases ?? []) {
      for (const hit of findAll(reply, phrasePattern(phrase))) {
        add(category, baseSeverity(rules, category), hit, def.explain);
      }
    }
  }

  // 2. Clinic-type terms (procedures, drugs). Unsafe when tied to the reader ("your filler").
  const termCategory = Object.entries(rules.categories).find(([, d]) => d.uses_clinic_type_terms)?.[0] ?? "treatment_details";
  for (const term of clinicTerms) {
    for (const hit of findAll(reply, phrasePattern(term))) {
      const window = reply.slice(Math.max(0, hit.start - TERM_WINDOW), Math.min(reply.length, hit.end + TERM_WINDOW));
      const tied = SECOND_PERSON.test(window);
      add(
        termCategory,
        tied ? "unsafe" : "caution",
        hit,
        tied
          ? explain(rules, termCategory, "Mentions a treatment tied to the reviewer.")
          : `Mentions "${hit.match}". Make sure nothing ties it to the reviewer.`,
      );
    }
  }

  // 3. Identifiers: names, staff, dates, times.
  for (const m of reply.matchAll(SALUTATION_NAME)) {
    const name = m[1]!;
    if (NOT_NAMES.has(name)) continue;
    const start = m.index! + m[0].lastIndexOf(name);
    add("identifiers", "caution", { match: name, start, end: start + name.length }, "Uses the reviewer's name. On its own that's a caution; with any other flag it's unsafe.");
  }
  for (const m of reply.matchAll(VOCATIVE_NAME)) {
    const name = m[1]!;
    if (NOT_NAMES.has(name)) continue;
    // "call our office manager, Maria" names the clinic's own contact, not the reviewer.
    if (/\b(?:manager|coordinator|director|owner|administrator|supervisor|lead|receptionist|concierge)\s*$/i.test(reply.slice(Math.max(0, m.index! - 40), m.index!))) continue;
    const start = m.index! + m[0].indexOf(name);
    if (isSignOff(reply, start, start + name.length)) continue;
    add("identifiers", "caution", { match: name, start, end: start + name.length }, "Uses the reviewer's name. On its own that's a caution; with any other flag it's unsafe.");
  }
  for (const hit of findAll(reply, TITLED_NAME)) {
    add("identifiers", "caution", hit, "Uses the reviewer's name. On its own that's a caution; with any other flag it's unsafe.");
  }
  for (const hit of findAll(reply, STAFF_NAME)) {
    if (isSignOff(reply, hit.start, hit.end)) continue;
    add("identifiers", "unsafe", hit, "Names a staff member, which can reveal who cared for the reviewer.");
  }
  for (const pattern of DATES) {
    for (const hit of findAll(reply, pattern)) add("identifiers", "unsafe", hit, "Mentions a date, which can place the reviewer at the clinic.");
  }
  for (const hit of findAll(reply, TIMES)) add("identifiers", "unsafe", hit, "Mentions a time, which can place the reviewer at the clinic.");

  // 4. Negative-sounding reply with no way to take the conversation offline. This flags
  // something missing, so it has no text span (match is empty; nothing is highlighted).
  if (APOLOGY.test(reply) && !CONTACT_PATH.test(reply) && rules.categories.no_private_path) {
    add("no_private_path", "caution", { match: "", start: 0, end: 0 }, explain(rules, "no_private_path", "Doesn't invite the reviewer to contact the office directly."));
  }

  return finalize(dedupe(flags));
}

/** Removes duplicate flags for the same span and category, keeping the most severe. */
export function dedupe(flags: ReplyFlag[]): ReplyFlag[] {
  const sorted = [...flags].sort((a, b) => a.start - b.start || (a.severity === "unsafe" ? -1 : 1));
  const out: ReplyFlag[] = [];
  for (const f of sorted) {
    const dup = out.find((o) => o.category === f.category && o.start < f.end && f.start < o.end);
    if (!dup) out.push(f);
  }
  return out;
}

/** Applies the name rule ("unsafe with any other flag") and computes the verdict. */
export function finalize(flags: ReplyFlag[]): ReplyCheckResult {
  const isName = (f: ReplyFlag) => f.category === "identifiers" && f.severity === "caution";
  const hasOther = flags.some((f) => !isName(f));
  const adjusted = flags.map((f) =>
    isName(f) && hasOther ? { ...f, severity: "unsafe" as const } : f,
  );
  const verdict: Verdict = adjusted.some((f) => f.severity === "unsafe")
    ? "unsafe"
    : adjusted.length > 0
      ? "needs_changes"
      : "safe";
  return { verdict, flags: adjusted.sort((a, b) => a.start - b.start) };
}
