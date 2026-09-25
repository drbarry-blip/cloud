import * as cheerio from "cheerio";
import type { Signature } from "../playbook/schema";
import { collectUrls, matchSignatures, nativeContactForms, type PageHtml } from "../visibility/detect";

// Finds the ways a new patient can reach a clinic online: contact forms and
// public email addresses. The owner confirms the results before a test.

export interface DiscoveredForm {
  pageUrl: string;
  kind: "native" | "embedded";
  /** The form service, for embedded forms (e.g. "Jotform"). */
  provider: string | null;
  fields: number | null;
}

export interface ContactRoutes {
  forms: DiscoveredForm[];
  /** Public addresses, the clinic's own domain first. */
  emails: string[];
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}/g;
// Addresses that show up in page source but aren't the clinic's inbox.
const IGNORED_EMAIL = /^(?:no-?reply|donotreply|do-not-reply|mailer-daemon|postmaster|abuse|privacy|dmca|webmaster)@|@(?:example\.(?:com|org|net)|sentry\.io|[^@]*\.sentry\.io|wixpress\.com|sentry-next\.wixpress\.com|domain\.com|email\.com|yourdomain\.com|yoursite\.com)$/i;
const FILE_LIKE = /\.(?:png|jpe?g|gif|webp|svg|css|js)$/i;

/** Cloudflare's email obfuscation: the first byte is a key XORed into the rest. */
export function decodeCloudflareEmail(hex: string): string | null {
  if (!/^(?:[0-9a-f]{2}){2,}$/i.test(hex)) return null;
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(out) ? out : null;
}

function cleanEmail(raw: string): string | null {
  const email = raw.trim().replace(/^mailto:/i, "").split("?")[0]!.trim().toLowerCase();
  let decoded: string;
  try {
    decoded = decodeURIComponent(email);
  } catch {
    decoded = email;
  }
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,24}$/.test(decoded)) return null;
  if (IGNORED_EMAIL.test(decoded) || FILE_LIKE.test(decoded)) return null;
  return decoded;
}

const bareHost = (host: string) => host.toLowerCase().replace(/^www\./, "");

/**
 * Reads contact forms and email addresses from already-fetched pages of a clinic's
 * website. Pure: no network access. Native forms count only if they take a message
 * or a phone number, so newsletter sign-ups aren't mistaken for contact forms.
 */
export function discoverContactRoutes(pages: readonly PageHtml[], opts: { embeddedSignatures: readonly Signature[] }): ContactRoutes {
  const forms: DiscoveredForm[] = [];
  const emails = new Set<string>();
  for (const page of pages) {
    const $ = cheerio.load(page.html);
    const usable = nativeContactForms($).filter((f) => f.hasMessageBox || f.hasPhoneField);
    if (usable.length) forms.push({ pageUrl: page.url, kind: "native", provider: null, fields: Math.min(...usable.map((f) => f.fields)) });
    for (const provider of matchSignatures(collectUrls($), opts.embeddedSignatures)) {
      forms.push({ pageUrl: page.url, kind: "embedded", provider, fields: null });
    }

    $('a[href^="mailto:" i]').each((_, el) => {
      const e = cleanEmail($(el).attr("href") ?? "");
      if (e) emails.add(e);
    });
    $("[data-cfemail]").each((_, el) => {
      const e = cleanEmail(decodeCloudflareEmail($(el).attr("data-cfemail") ?? "") ?? "");
      if (e) emails.add(e);
    });
    $('a[href*="/cdn-cgi/l/email-protection#"]').each((_, el) => {
      const hex = ($(el).attr("href") ?? "").split("#")[1] ?? "";
      const e = cleanEmail(decodeCloudflareEmail(hex) ?? "");
      if (e) emails.add(e);
    });
    $("script, style, noscript").remove();
    for (const m of $("body").text().matchAll(EMAIL)) {
      const e = cleanEmail(m[0]);
      if (e) emails.add(e);
    }
  }

  const siteHost = pages[0] ? bareHost(new URL(pages[0].url).hostname) : "";
  const onSite = (e: string) => {
    const d = e.split("@")[1]!;
    return d === siteHost || siteHost.endsWith(`.${d}`) || d.endsWith(`.${siteHost}`);
  };
  const ranked = [...emails].sort((a, b) => Number(onSite(b)) - Number(onSite(a)));

  // One entry per page and kind; native forms first.
  const seen = new Set<string>();
  const uniqueForms = forms
    .sort((a, b) => Number(a.kind === "embedded") - Number(b.kind === "embedded"))
    .filter((f) => {
      const key = `${f.pageUrl}|${f.kind}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return { forms: uniqueForms, emails: ranked.slice(0, 5) };
}
