import "server-only";
import { BRAND } from "../brand";
import { config } from "../config";
import type { VisibilityScanRecord } from "../store";
import { createToken } from "../tokens";
import type { OutgoingEmail } from "./mailer";

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export interface Block {
  text: string;
  /** Optional link rendered as a button in HTML and a bare URL in text. */
  link?: { label: string; href: string };
}

function unsubscribeUrl(leadId: string): string {
  return `${config.siteUrl()}/unsubscribe?t=${encodeURIComponent(createToken("unsubscribe", leadId))}`;
}

/**
 * Who the email is for decides its footer. Tool and marketing emails carry an
 * unsubscribe link (marketing also gets one-click unsubscribe headers); transactional
 * emails (receipts, test updates, reports) say why they were sent instead.
 */
export type Footer = { kind: "tool" | "marketing"; leadId: string } | { kind: "transactional"; reason: string };

export function renderEmail(subject: string, blocks: Block[], footer: Footer): Omit<OutgoingEmail, "to"> {
  const unsub = footer.kind === "transactional" ? null : unsubscribeUrl(footer.leadId);
  const reason = footer.kind === "transactional" ? footer.reason : "You're getting this because you used one of our free tools.";
  const footerText = [`${BRAND.name} · ${config.mailingAddress()}`, reason, ...(unsub ? [`Unsubscribe: ${unsub}`] : [])].join("\n");
  const text = [...blocks.map((b) => (b.link ? `${b.text}\n${b.link.label}: ${b.link.href}` : b.text)), "—", footerText].join("\n\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1d2733">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;padding:28px">
<tr><td style="font-weight:700;font-size:15px;color:#0f5c63;padding-bottom:16px">${escapeHtml(BRAND.name)}</td></tr>
${blocks
  .map((b) => {
    const p = `<p style="font-size:16px;line-height:1.55;margin:0 0 16px">${escapeHtml(b.text).replace(/\n/g, "<br>")}</p>`;
    const btn = b.link
      ? `<p style="margin:0 0 20px"><a href="${escapeHtml(b.link.href)}" style="background:#0f5c63;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;display:inline-block;font-weight:600">${escapeHtml(b.link.label)}</a></p>`
      : "";
    return `<tr><td>${p}${btn}</td></tr>`;
  })
  .join("\n")}
<tr><td style="border-top:1px solid #e3e8ee;padding-top:16px;font-size:12px;line-height:1.5;color:#5b6b7b">
${escapeHtml(BRAND.name)} · ${escapeHtml(config.mailingAddress())}<br>
${escapeHtml(reason)}${unsub ? `<br>\n<a href="${escapeHtml(unsub)}" style="color:#5b6b7b">Unsubscribe</a>` : ""}</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html, unsubscribeUrl: footer.kind === "marketing" ? unsub! : undefined };
}

const render = (leadId: string, subject: string, blocks: Block[], marketing: boolean) =>
  renderEmail(subject, blocks, { kind: marketing ? "marketing" : "tool", leadId });

/** Sent after any email capture. Marketing email only starts after the confirm click (double opt-in). */
export function confirmEmail(leadId: string, opts: { marketingConsent: boolean; scan?: VisibilityScanRecord & { id: string } }): Omit<OutgoingEmail, "to"> {
  const site = config.siteUrl();
  const blocks: Block[] = [];
  if (opts.scan) {
    const s = opts.scan;
    const pillars = s.pillars.map((p) => `• ${p.label}: ${Math.round(p.score)}/${p.maxPoints}`).join("\n");
    const wins = s.quickWins.map((w, i) => `${i + 1}. ${w}`).join("\n");
    blocks.push(
      { text: `Here's the Visibility Score for ${s.clinicName}: ${s.total}/100.` },
      { text: pillars },
      ...(wins ? [{ text: `Your quick wins:\n${wins}` }] : []),
      { text: "See the full breakdown and nearby competitors any time:", link: { label: "View your results", href: `${site}/tools/visibility-score` } },
    );
  }
  if (opts.marketingConsent) {
    blocks.push({
      text: "Please confirm your email so we can send you occasional tips on turning more inquiries into patients. If you didn't request this, ignore this email and you won't hear from us.",
      link: { label: "Confirm my email", href: `${site}/confirm?t=${encodeURIComponent(createToken("confirm", leadId))}` },
    });
  } else if (!opts.scan) {
    blocks.push({ text: "Thanks for trying our free tools. We won't send you marketing email unless you ask for it." });
  }
  const subject = opts.scan ? `Your Visibility Score: ${opts.scan.total}/100` : "Please confirm your email";
  return render(leadId, subject, blocks, false);
}

export const NURTURE_DAYS = [2, 5, 9] as const;

/** The nurture sequence after confirmation (SPEC.md §13). Step numbers are 1-based. */
export function nurtureEmail(leadId: string, step: number): Omit<OutgoingEmail, "to"> | null {
  const site = config.siteUrl();
  switch (step) {
    case 1:
      return render(leadId, "How fast does your front desk answer new patients?", [
        { text: "Quick question: when someone fills out the contact form on your website, how long until a real person calls them back?" },
        { text: "Most owners guess \"within an hour.\" When clinics actually test it, the answer is often the next day, or never. By then, many of those leads have booked somewhere else." },
        { text: "Try this today: send an inquiry through your own website from a personal email, and note the time. Then watch what happens over the next few days: who calls, how fast, and how many times they try." },
        { text: "Want a second opinion on your online presence while you wait?", link: { label: "Run your free Visibility Score", href: `${site}/tools/visibility-score` } },
      ], true);
    case 2:
      return render(leadId, "What a front-desk secret shopper report looks like", [
        { text: "We're building a Secret Shopper for clinics: fictional new patients contact your clinic through your website and email, and you get a graded report on what happened." },
        { text: "The report shows a timeline of every call, voicemail, text, and email your team sent back; a score for speed, persistence, and conversation quality; your top three fixes; and scripts your front desk can use the same day." },
        { text: "No real patient data is involved, and nothing is ever booked on your schedule.", link: { label: "See how it works", href: `${site}/secret-shopper` } },
      ], true);
    case 3:
      if (config.shopperOpen()) {
        return render(leadId, "See what happens when a new patient reaches out", [
          { text: "The Secret Shopper is open for med spas, hormone and weight-loss clinics, dental practices, and chiropractic, PT, and wellness clinics." },
          { text: "Three fictional new patients contact your clinic through your website and email. Two weeks later you get a graded report, your top three fixes, and scripts your front desk can use the same day.", link: { label: "Start a test", href: `${site}/secret-shopper` } },
          { text: "Either way, thanks for reading. We'll keep the tips coming, and you can unsubscribe any time below." },
        ], true);
      }
      return render(leadId, "Want to be first in line for the Secret Shopper?", [
        { text: "The Secret Shopper is launching soon for med spas, hormone and weight-loss clinics, dental practices, and chiropractic, PT, and wellness clinics." },
        { text: "Join the waitlist and we'll let you know the day it opens, with launch pricing for early clinics.", link: { label: "Join the waitlist", href: `${site}/secret-shopper#waitlist` } },
        { text: "Either way, thanks for reading. We'll keep the tips coming, and you can unsubscribe any time below." },
      ], true);
    default:
      return null;
  }
}
