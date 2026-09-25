import { DateTime } from "luxon";
import type { Weekday } from "../playbook/shopper-schema";
import type { WeeklyHours } from "./time";

// Helpers for setting up a clinic for a test: time zone, hours, phone numbers,
// and whether a buyer's email address belongs to the clinic's website.

export const US_TIMEZONES = [
  { id: "America/New_York", label: "Eastern" },
  { id: "America/Chicago", label: "Central" },
  { id: "America/Denver", label: "Mountain" },
  { id: "America/Phoenix", label: "Arizona (no daylight saving)" },
  { id: "America/Los_Angeles", label: "Pacific" },
  { id: "America/Anchorage", label: "Alaska" },
  { id: "Pacific/Honolulu", label: "Hawaii" },
  { id: "America/Puerto_Rico", label: "Atlantic (Puerto Rico)" },
] as const;

const E = "America/New_York";
const C = "America/Chicago";
const M = "America/Denver";
const P = "America/Los_Angeles";

// Main zone first; split states list the other zone second.
const STATE_ZONES: Record<string, string[]> = {
  AL: [C], AK: ["America/Anchorage"], AZ: ["America/Phoenix"], AR: [C], CA: [P], CO: [M], CT: [E], DE: [E], DC: [E],
  FL: [E, C], GA: [E], HI: ["Pacific/Honolulu"], ID: [M, P], IL: [C], IN: [E, C], IA: [C], KS: [C, M], KY: [E, C],
  LA: [C], ME: [E], MD: [E], MA: [E], MI: [E, C], MN: [C], MS: [C], MO: [C], MT: [M], NE: [C, M], NV: [P], NH: [E],
  NJ: [E], NM: [M], NY: [E], NC: [E], ND: [C, M], OH: [E], OK: [C], OR: [P, M], PA: [E], RI: [E], SC: [E], SD: [C, M],
  TN: [C, E], TX: [C, M], UT: [M], VT: [E], VA: [E], WA: [P], WV: [E], WI: [C], WY: [M], PR: ["America/Puerto_Rico"],
};

/** The two-letter state in a US address like "1 Main St, Austin, TX 78701, USA". */
export function stateFromAddress(address: string): string | null {
  const m = /,\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?\s*(?:,\s*(?:USA|United States))?\s*$/.exec(address.trim());
  return m && STATE_ZONES[m[1]!] ? m[1]! : null;
}

/**
 * A best guess at a clinic's IANA time zone from its address, using Google's current
 * UTC offset (when known) to pick the right zone in split states. The owner confirms it.
 */
export function guessTimezone(address: string, utcOffsetMinutes?: number | null, at: Date = new Date()): string | null {
  const state = stateFromAddress(address);
  const zones = state ? STATE_ZONES[state]! : null;
  if (!zones) return null;
  if (utcOffsetMinutes != null) {
    const match = zones.find((z) => DateTime.fromJSDate(at).setZone(z).offset === utcOffsetMinutes);
    if (match) return match;
  }
  return zones[0]!;
}

/** Google Places "regularOpeningHours.periods" (day 0 = Sunday). */
export interface GooglePeriod {
  open: { day: number; hour: number; minute?: number };
  close?: { day: number; hour: number; minute?: number };
}

const GOOGLE_DAY: Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const hm = (h: number, m = 0) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

/**
 * Converts Google's opening periods to one open interval per weekday. Split days
 * (e.g. closed for lunch) become earliest open to latest close; hours past midnight
 * end at 23:59. Returns null when there are no periods.
 */
export function weeklyHoursFromGoogle(periods: readonly GooglePeriod[] | null | undefined): WeeklyHours | null {
  if (!periods?.length) return null;
  const hours: WeeklyHours = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };
  // Open around the clock: a single period that opens Sunday 00:00 and never closes.
  if (periods.length === 1 && !periods[0]!.close) {
    for (const d of GOOGLE_DAY) hours[d] = { open: "00:00", close: "23:59" };
    return hours;
  }
  for (const p of periods) {
    const day = GOOGLE_DAY[p.open.day];
    if (!day || !p.close) continue;
    const open = hm(p.open.hour, p.open.minute);
    const close = p.close.day === p.open.day ? hm(p.close.hour, p.close.minute) : "23:59";
    const cur = hours[day];
    hours[day] = cur ? { open: open < cur.open ? open : cur.open, close: close > cur.close ? close : cur.close } : { open, close };
  }
  return hours;
}

/** A US phone number in E.164 (+15125550123), or null if it isn't one. */
export function normalizeUsPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(ten) ? `+1${ten}` : null;
}

/** A website's host without "www.", or null if it isn't a usable http(s) URL. */
export function websiteHost(website: string | null | undefined): string | null {
  if (!website?.trim()) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(website.trim()) ? website.trim() : `https://${website.trim()}`);
    if (!/^https?:$/.test(url.protocol) || !url.hostname.includes(".")) return null;
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

// Website builders and hosts where anyone can get a subdomain.
const SHARED_HOSTS = [
  "wixsite.com", "wix.com", "squarespace.com", "business.site", "godaddysites.com", "weebly.com", "square.site", "webflow.io",
  "netlify.app", "vercel.app", "github.io", "wordpress.com", "blogspot.com", "myshopify.com", "carrd.co", "site123.me",
  "jimdosite.com", "mystrikingly.com", "strikingly.com", "yolasite.com", "google.com", "sites.google.com", "facebook.com",
  "instagram.com", "linktr.ee", "vagaro.com", "mindbodyonline.com", "janeapp.com", "zocdoc.com", "square.com",
];

// Personal mailbox providers: an address here says nothing about who owns a clinic.
const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com", "outlook.com", "live.com", "msn.com", "aol.com",
  "icloud.com", "me.com", "mac.com", "proton.me", "protonmail.com", "gmx.com", "mail.com", "zoho.com", "yandex.com",
  "comcast.net", "att.net", "sbcglobal.net", "verizon.net", "bellsouth.net", "cox.net", "charter.net",
]);

const isShared = (domain: string) => SHARED_HOSTS.some((h) => domain === h || domain.endsWith(`.${h}`));

/**
 * True when an email address is on the clinic website's own domain, which is enough
 * to verify ownership automatically (SPEC.md §7.1). Free mailboxes and shared
 * website builders never match.
 */
export function emailMatchesWebsite(email: string, website: string | null | undefined): boolean {
  const host = websiteHost(website);
  const domain = email.trim().toLowerCase().split("@")[1];
  if (!host || !domain || !domain.includes(".")) return false;
  if (FREE_MAIL.has(domain) || isShared(domain) || isShared(host)) return false;
  return domain === host || domain.endsWith(`.${host}`) || host.endsWith(`.${domain}`);
}

/** "Oct 3–18" or "Oct 28 – Nov 12" (dates only, in the clinic's time zone). Never shows times. */
export function formatDateRange(start: Date, end: Date, timezone: string): string {
  const a = DateTime.fromJSDate(start).setZone(timezone);
  const b = DateTime.fromJSDate(end).setZone(timezone);
  const year = a.year !== b.year || a.year !== DateTime.now().setZone(timezone).year ? `, ${b.year}` : "";
  if (a.hasSame(b, "month")) return `${a.toFormat("LLL d")}–${b.toFormat("d")}${year}`;
  return `${a.toFormat("LLL d")} – ${b.toFormat("LLL d")}${year}`;
}

/** The area code of a US phone number in any common format, or null. */
export function areaCodeOrNull(phone: string | null | undefined): string | null {
  return normalizeUsPhone(phone)?.slice(2, 5) ?? null;
}
