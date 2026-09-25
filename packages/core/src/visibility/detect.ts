import * as cheerio from "cheerio";
import type { Signature, VisibilityScoreRules } from "../playbook/schema";

export interface PageHtml {
  url: string;
  html: string;
}

export interface WebsiteSignals {
  https: boolean;
  mobileViewport: boolean;
  bookingTools: string[];
  chatWidgets: string[];
  tapToCall: boolean;
  textLink: boolean;
  contactForm: "none" | "embedded" | number;
  newPatientCtaAboveFold: boolean;
}

const URL_ATTRS = ["src", "href", "data-src", "action", "data-url"];
const CTA_TEXT = /\b(?:book|schedule|request|reserve)\b[^.]{0,30}\b(?:appointment|consult(?:ation)?|visit|now|online|today|exam)\b|\bnew patients?\b|\bbook now\b/i;
const COUNTED_INPUT_TYPES = new Set(["text", "email", "tel", "number", "date", "datetime-local", "url", ""]);
/** How many links/buttons from the top of the page count as "near the top". Heuristic until Phase 2 renders pages. */
const NEAR_TOP_ELEMENTS = 15;

function matchSignatures(haystack: readonly string[], signatures: readonly Signature[]): string[] {
  const found = new Set<string>();
  for (const sig of signatures) {
    if (haystack.some((h) => sig.domains.some((d) => h.includes(d.toLowerCase())))) found.add(sig.name);
  }
  return [...found];
}

function collectUrls($: cheerio.CheerioAPI): string[] {
  const urls: string[] = [];
  $("*").each((_, el) => {
    // <script> and <style> elements have their own node types but still carry attributes.
    if (!("attribs" in el)) return;
    for (const attr of URL_ATTRS) {
      const v = el.attribs[attr];
      if (v) urls.push(v.toLowerCase());
    }
  });
  // Widgets are often injected by inline scripts that mention their domain.
  $("script:not([src])").each((_, el) => {
    const text = $(el).text();
    if (text) urls.push(text.toLowerCase().slice(0, 20_000));
  });
  return urls;
}

function countFormFields($: cheerio.CheerioAPI): number | null {
  let best: number | null = null;
  $("form").each((_, form) => {
    const $form = $(form);
    const inputs = $form.find("input").filter((_, el) => COUNTED_INPUT_TYPES.has(($(el).attr("type") ?? "").toLowerCase()));
    const fields = inputs.length + $form.find("textarea").length + $form.find("select").length;
    const looksLikeContact =
      fields >= 2 &&
      ($form.find("textarea").length > 0 ||
        $form.find('input[type="email"], input[type="tel"]').length > 0 ||
        /name|phone|email|message/i.test($form.html() ?? ""));
    const isSearch = ($form.attr("role") ?? "") === "search" || $form.find('input[type="search"]').length > 0;
    if (looksLikeContact && !isSearch) best = best === null ? fields : Math.min(best, fields);
  });
  return best;
}

function ctaNearTop($: cheerio.CheerioAPI): boolean {
  const inHeader = $("header a, header button, nav a, nav button")
    .toArray()
    .some((el) => CTA_TEXT.test($(el).text()));
  if (inHeader) return true;
  return $("a, button")
    .toArray()
    .slice(0, NEAR_TOP_ELEMENTS)
    .some((el) => CTA_TEXT.test($(el).text()) || CTA_TEXT.test($(el).attr("aria-label") ?? ""));
}

/**
 * Reads booking-ease and basic website signals from already-fetched pages.
 * The first page must be the homepage. Pure: no network access.
 */
export function detectWebsiteSignals(pages: readonly PageHtml[], rules: VisibilityScoreRules): WebsiteSignals {
  if (pages.length === 0) throw new Error("detectWebsiteSignals needs at least the homepage");
  const home = pages[0]!;
  const $home = cheerio.load(home.html);

  const allUrls: string[] = [];
  let tapToCall = false;
  let textLink = false;
  let nativeFields: number | null = null;
  for (const page of pages) {
    const $ = page === home ? $home : cheerio.load(page.html);
    allUrls.push(...collectUrls($));
    tapToCall ||= $('a[href^="tel:"]').length > 0;
    textLink ||= $('a[href^="sms:"]').length > 0;
    const fields = countFormFields($);
    if (fields !== null) nativeFields = nativeFields === null ? fields : Math.min(nativeFields, fields);
  }

  const embedded = matchSignatures(allUrls, rules.embedded_form_signatures).length > 0;
  const viewport = $home('meta[name="viewport"]').attr("content") ?? "";

  return {
    https: home.url.toLowerCase().startsWith("https://"),
    mobileViewport: /width\s*=\s*device-width/i.test(viewport),
    bookingTools: matchSignatures(allUrls, rules.booking_tool_signatures),
    chatWidgets: matchSignatures(allUrls, rules.chat_widget_signatures),
    tapToCall,
    textLink,
    contactForm: nativeFields !== null ? nativeFields : embedded ? "embedded" : "none",
    newPatientCtaAboveFold: ctaNearTop($home),
  };
}

const KEY_PAGE = /contact|book|booking|schedule|appointment|request|new-patient|new_patient|services/i;

/** Picks up to `limit` same-site links worth crawling (contact, booking, services). */
export function findKeyPageLinks(homeUrl: string, html: string, limit = 5): string[] {
  const base = new URL(homeUrl);
  const $ = cheerio.load(html);
  const out: string[] = [];
  $("a[href]").each((_, el) => {
    if (out.length >= limit) return false;
    const href = $(el).attr("href")!;
    const text = $(el).text();
    if (!KEY_PAGE.test(href) && !KEY_PAGE.test(text)) return;
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      return;
    }
    if (url.hostname !== base.hostname || !/^https?:$/.test(url.protocol)) return;
    url.hash = "";
    const s = url.toString();
    if (s !== base.toString() && !out.includes(s)) out.push(s);
    return;
  });
  return out;
}
