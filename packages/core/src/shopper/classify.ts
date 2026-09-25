// Heuristic labeling of the clinic's touches. AI labeling can refine these later;
// the heuristics are the always-available baseline and are deliberately conservative.

export type TouchChannel = "email" | "sms" | "call";
export type TouchLabel = "personal" | "auto_reply" | "marketing" | "reminder";

export interface TouchInput {
  channel: TouchChannel;
  subject?: string;
  text?: string;
  /** Raw email headers (lowercased keys) when available. */
  headers?: Record<string, string>;
}

const AUTO_SUBJECT = /\b(?:automatic reply|auto(?:-|\s)?reply|out of (?:the )?office|we(?:'|’)?ve received|we received your|thank you for (?:contacting|reaching out|your (?:message|inquiry|request)))\b/i;
const AUTO_BODY = /\b(?:this is an automated|automated (?:message|response)|do not reply|please do not respond|no-?reply|we(?:'|’)?ve received your (?:message|inquiry|request)|we have received your (?:message|inquiry|request)|someone (?:from our team )?will (?:get back to you|be in touch|contact you|reach out))\b/i;
const MARKETING = /\b(?:unsubscribe|view (?:this email )?in (?:your )?browser|promo code|limited time|newsletter|special offer|\d+% off)\b/i;
const REMINDER = /\b(?:appointment reminder|reminder:|confirm your appointment|reply c to confirm)\b/i;
const URL = /\bhttps?:\/\/[^\s<>"')]+/i;

/** Labels one touch. Calls from the clinic are always personal (a person dialed). */
export function classifyTouch(t: TouchInput): TouchLabel {
  if (t.channel === "call") return "personal";
  const h = t.headers ?? {};
  const autoHeader =
    (h["auto-submitted"] && h["auto-submitted"].toLowerCase() !== "no") ||
    "x-autoreply" in h ||
    "x-autorespond" in h ||
    /auto_reply|oof/i.test(h["x-auto-response-suppress"] ?? "");
  const text = `${t.subject ?? ""}\n${t.text ?? ""}`;
  if (REMINDER.test(text)) return "reminder";
  if (autoHeader || AUTO_SUBJECT.test(t.subject ?? "") || AUTO_BODY.test(t.text ?? "")) return "auto_reply";
  if (MARKETING.test(text) && (t.text?.match(/https?:\/\//g)?.length ?? 0) >= 2) return "marketing";
  return "personal";
}

export const isHumanTouch = (label: TouchLabel) => label === "personal";

export function hasLink(text: string | undefined): boolean {
  return URL.test(text ?? "");
}

export function hasPhoneNumber(text: string | undefined): boolean {
  return /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/.test(text ?? "") || /\b(?:\d[\s,.-]*){10}\b/.test(text ?? "");
}

export interface Observation {
  id: string;
  quote: string;
}

const CLAIMS: RegExp[] = [
  /\bguarantee[ds]?\b[^.]{0,40}/i,
  /\bfda[- ]approved\b[^.]{0,40}/i,
  /\bpainless\b/i,
  /\bpermanent(?:ly)?\b[^.]{0,30}/i,
  /\blose \d+\s?(?:lbs?|pounds)\b[^.]{0,30}/i,
  /\bno (?:side effects|downtime)\b/i,
  /\b(?:cure|cures|cured)\b[^.]{0,30}/i,
];
const SENSITIVE_REQUEST: RegExp[] = [
  /\b(?:date of birth|dob|social security|ssn)\b[^.?]{0,40}/i,
  /\b(?:photo|picture|copy) of (?:your )?(?:insurance|id|license|driver'?s license)\b[^.?]{0,30}/i,
  /\b(?:medical history|medications you(?:'re| are) taking|list of (?:your )?medications|diagnos(?:is|es))\b[^.?]{0,40}/i,
];

/** "Worth a look" notes from a touch's text (SPEC.md §7.1). Never scored. */
export function findObservations(channel: TouchChannel, text: string | undefined): Observation[] {
  if (!text) return [];
  const out: Observation[] = [];
  for (const re of CLAIMS) {
    const m = text.match(re);
    if (m) out.push({ id: "unsupported_claims", quote: m[0].trim() });
  }
  if (channel !== "call") {
    for (const re of SENSITIVE_REQUEST) {
      const m = text.match(re);
      if (m) out.push({ id: "sensitive_info_by_plain_message", quote: m[0].trim() });
    }
  }
  return out;
}
