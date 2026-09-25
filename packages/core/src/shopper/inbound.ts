// Reading what clinics send back to personas: strip quoted history, spot bounces,
// trip the PHI wire, and notice what the clinic asked for so the persona can
// politely decline (playbook `deflections`).

const QUOTE_MARKERS: RegExp[] = [
  // Gmail/Apple: "On Mon, Oct 5, 2026 at 10:02 AM Jessica <j@x> wrote:" (sometimes wrapped onto two lines)
  /(?:^|\n)[ \t]*On [^\n]{3,200}(?:\n[^\n]{0,200})?\bwrote:[ \t]*(?:\n|$)/,
  /(?:^|\n)[ \t]*-{2,}\s*Original Message\s*-{2,}/i,
  /(?:^|\n)[ \t]*-{2,}\s*Forwarded message\s*-{2,}/i,
  // Outlook: a rule line or a From:/Sent: header block
  /(?:^|\n)[ \t]*_{8,}[ \t]*\n[ \t]*From:/,
  /(?:^|\n)[ \t]*From:[^\n]+\n[ \t]*(?:Sent|Date):[^\n]+\n/i,
];

/** The new part of an email reply, without the quoted history below it. */
export function stripQuotedReply(text: string): string {
  let cut = text.length;
  for (const re of QUOTE_MARKERS) {
    const m = re.exec(text);
    if (m && m.index < cut) cut = m.index;
  }
  const lines = text.slice(0, cut).replace(/\r\n/g, "\n").split("\n");
  // Drop a trailing block of "> quoted" lines.
  while (lines.length && (/^\s*>/.test(lines[lines.length - 1]!) || lines[lines.length - 1]!.trim() === "")) lines.pop();
  return lines.join("\n").trim();
}

/** A delivery failure notice rather than a message from the clinic. */
export function looksLikeBounce(msg: { from?: string | null; subject?: string | null; headers?: Record<string, string> }): boolean {
  const from = (msg.from ?? "").toLowerCase();
  const subject = msg.subject ?? "";
  const contentType = msg.headers?.["content-type"] ?? "";
  return (
    /^(?:[^<]*<)?(?:mailer-daemon|postmaster)@/.test(from) ||
    /report-type=delivery-status/i.test(contentType) ||
    /\b(?:undeliverable|undelivered mail|delivery status notification \(failure\)|mail delivery (?:failed|subsystem)|delivery has failed|returned mail|address not found)\b/i.test(subject)
  );
}

export type PhiSignal = "date_of_birth" | "ssn_like" | "record_number" | "insurance_id" | "clinical_detail_about_named_person" | "records_attachment";

const PHI_PATTERNS: [PhiSignal, RegExp][] = [
  ["date_of_birth", /\b(?:dob|d\.o\.b\.|date of birth|birth ?date)\s*[:\-]?\s*\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/i],
  ["ssn_like", /\b\d{3}-\d{2}-\d{4}\b/],
  ["record_number", /\b(?:mrn|medical record (?:number|no\.?|#)|chart (?:number|no\.?|#)|patient (?:id|number|no\.?|#))\s*[:#]?\s*[A-Z0-9-]*\d[A-Z0-9-]{3,}/i],
  ["insurance_id", /\b(?:member|subscriber|policy|group) (?:id|number|no\.?|#)\s*[:#]?\s*[A-Z0-9-]*\d[A-Z0-9-]{4,}/i],
  [
    "clinical_detail_about_named_person",
    /\b(?:lab results?|test results?|diagnos(?:is|ed)|prescription|treatment plan|visit notes?)\b[^.\n]{0,60}\b(?:for|of)\s+(?:mr\.?|mrs\.?|ms\.?\s+)?[A-Z][a-z]+\s+[A-Z][a-z]+/,
  ],
];

/**
 * Signs that a message holds a real patient's information (SPEC.md §9.1). Returns
 * reasons only, never the matched text. Deliberately cautious: a person reviews
 * every flag, so false alarms are cheap and misses are not.
 */
export function phiSignals(text: string | null | undefined, attachmentNames: readonly string[] = []): PhiSignal[] {
  const out = new Set<PhiSignal>();
  for (const [id, re] of PHI_PATTERNS) if (text && re.test(text)) out.add(id);
  if (attachmentNames.some((n) => /\b(?:records?|chart|labs?|results?|intake|history|referral|x-?rays?|scan)\b/i.test(n.replace(/[_.-]/g, " ")))) {
    out.add("records_attachment");
  }
  return [...out];
}

export type DeflectionId = "medical_history" | "date_of_birth" | "insurance_details" | "intake_forms" | "payment_or_deposit";

const ASKS: [DeflectionId, RegExp][] = [
  ["medical_history", /\b(?:medical|health) history\b|\bmedications?\b|\bcurrent meds\b|\bany (?:medical )?conditions\b|\ballerg/i],
  ["date_of_birth", /\bdate of birth\b|\bdob\b|\bbirth ?date\b|\bhow old\b/i],
  ["insurance_details", /\binsurance (?:card|info|information|details|provider|carrier)\b|\bmember id\b|\bpolicy number\b|\bwhat insurance\b/i],
  ["intake_forms", /\bintake\b|\bnew patient (?:forms?|paperwork)\b|\bpaperwork\b|\bfill (?:out|in) (?:the|our|a|these|this)? ?forms?\b/i],
  ["payment_or_deposit", /\bdeposit\b|\bcard on file\b|\bcredit card\b|\bpayment (?:info|information|details)\b/i],
];

/** Things the clinic asked the persona for that personas never provide. */
export function requestedDeflections(text: string | null | undefined): DeflectionId[] {
  if (!text) return [];
  return ASKS.filter(([, re]) => re.test(text)).map(([id]) => id);
}

/** Whether a message states a price or range. */
export const mentionsPrice = (text: string | null | undefined) => /\$\s?\d|\b\d+\s?(?:dollars|per (?:unit|session|syringe|area|month|visit))\b/i.test(text ?? "");

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

/** Plain text from an HTML email body (for messages sent without a text part). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      const lower = e.toLowerCase();
      if (ENTITIES[lower]) return ENTITIES[lower]!;
      if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16));
      if (lower.startsWith("#")) return String.fromCodePoint(parseInt(lower.slice(1), 10));
      return m;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
