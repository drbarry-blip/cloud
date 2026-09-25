import { DateTime } from "luxon";
import type { ScriptId, Weekday, WindowRule } from "../playbook/shopper-schema";

/** Opening hours per weekday in the clinic's local time; null = closed that day. */
export type WeeklyHours = Record<Weekday, { open: string; close: string } | null>;

export interface ClinicClock {
  /** IANA time zone, e.g. "America/Chicago". */
  timezone: string;
  hours: WeeklyHours;
  /** Local dates (YYYY-MM-DD) the owner marked as closed. */
  blackoutDates: string[];
}

const WEEKDAY_BY_LUXON: Record<number, Weekday> = { 1: "mon", 2: "tue", 3: "wed", 4: "thu", 5: "fri", 6: "sat", 7: "sun" };

export const DEFAULT_HOURS: WeeklyHours = {
  mon: { open: "09:00", close: "17:00" },
  tue: { open: "09:00", close: "17:00" },
  wed: { open: "09:00", close: "17:00" },
  thu: { open: "09:00", close: "17:00" },
  fri: { open: "09:00", close: "17:00" },
  sat: null,
  sun: null,
};

// ---------- Holidays ----------

function nthWeekday(year: number, month: number, weekday: number, n: number): DateTime {
  let d = DateTime.utc(year, month, 1);
  while (d.weekday !== weekday) d = d.plus({ days: 1 });
  return d.plus({ weeks: n - 1 });
}

function lastWeekday(year: number, month: number, weekday: number): DateTime {
  let d = DateTime.utc(year, month, 1).endOf("month").startOf("day");
  while (d.weekday !== weekday) d = d.minus({ days: 1 });
  return d;
}

/** Fixed-date holidays move to Friday/Monday when they fall on a weekend. */
function observed(d: DateTime): DateTime {
  if (d.weekday === 6) return d.minus({ days: 1 });
  if (d.weekday === 7) return d.plus({ days: 1 });
  return d;
}

const holidayCache = new Map<number, Set<string>>();

/** US federal holidays (observed dates) for a year, as YYYY-MM-DD. */
export function usFederalHolidays(year: number): Set<string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;
  const days = [
    observed(DateTime.utc(year, 1, 1)),
    nthWeekday(year, 1, 1, 3), // MLK Day
    nthWeekday(year, 2, 1, 3), // Presidents Day
    lastWeekday(year, 5, 1), // Memorial Day
    observed(DateTime.utc(year, 6, 19)),
    observed(DateTime.utc(year, 7, 4)),
    nthWeekday(year, 9, 1, 1), // Labor Day
    nthWeekday(year, 10, 1, 2), // Columbus / Indigenous Peoples' Day
    observed(DateTime.utc(year, 11, 11)),
    nthWeekday(year, 11, 4, 4), // Thanksgiving
    observed(DateTime.utc(year, 12, 25)),
  ].map((d) => d.toISODate()!);
  // New Year's Day of next year can be observed on Dec 31 of this year.
  const nextNewYear = observed(DateTime.utc(year + 1, 1, 1));
  if (nextNewYear.year === year) days.push(nextNewYear.toISODate()!);
  const set = new Set(days);
  holidayCache.set(year, set);
  return set;
}

// ---------- Clinic hours ----------

function parseHm(hm: string): { hour: number; minute: number } {
  const [h, m] = hm.split(":").map(Number);
  return { hour: h!, minute: m! };
}

/** The clinic's open interval on a local date, or null if closed (weekly schedule, holiday, or blackout). */
export function openInterval(clock: ClinicClock, localDate: DateTime): { open: DateTime; close: DateTime } | null {
  const day = localDate.setZone(clock.timezone).startOf("day");
  const iso = day.toISODate()!;
  if (clock.blackoutDates.includes(iso) || usFederalHolidays(day.year).has(iso)) return null;
  const hours = clock.hours[WEEKDAY_BY_LUXON[day.weekday]!];
  if (!hours) return null;
  const open = day.set(parseHm(hours.open));
  const close = day.set(parseHm(hours.close));
  return close > open ? { open, close } : null;
}

export function isOpen(clock: ClinicClock, at: Date): boolean {
  const t = DateTime.fromJSDate(at).setZone(clock.timezone);
  const iv = openInterval(clock, t);
  return Boolean(iv && t >= iv.open && t < iv.close);
}

/** Minutes the clinic was open between two instants. */
export function businessMinutesBetween(clock: ClinicClock, start: Date, end: Date): number {
  if (end <= start) return 0;
  const s = DateTime.fromJSDate(start).setZone(clock.timezone);
  const e = DateTime.fromJSDate(end).setZone(clock.timezone);
  let total = 0;
  for (let day = s.startOf("day"); day <= e; day = day.plus({ days: 1 })) {
    const iv = openInterval(clock, day);
    if (!iv) continue;
    const from = iv.open > s ? iv.open : s;
    const to = iv.close < e ? iv.close : e;
    if (to > from) total += to.diff(from, "minutes").minutes;
  }
  return Math.round(total);
}

/** The local date of the first business day at or after `at` (today if the clinic is still open or yet to open today). */
export function arrivalBusinessDay(clock: ClinicClock, at: Date): string | null {
  const t = DateTime.fromJSDate(at).setZone(clock.timezone);
  for (let i = 0; i < 30; i++) {
    const day = t.startOf("day").plus({ days: i });
    const iv = openInterval(clock, day);
    if (iv && (i > 0 || t < iv.close)) return day.toISODate();
  }
  return null;
}

export function nextBusinessDayAfter(clock: ClinicClock, isoDate: string): string | null {
  const start = DateTime.fromISO(isoDate, { zone: clock.timezone });
  for (let i = 1; i < 30; i++) {
    const day = start.plus({ days: i });
    if (openInterval(clock, day)) return day.toISODate();
  }
  return null;
}

export function localDate(clock: ClinicClock, at: Date): string {
  return DateTime.fromJSDate(at).setZone(clock.timezone).toISODate()!;
}

// ---------- Random scheduling ----------

/** Small seeded PRNG (mulberry32) so schedules are reproducible in tests. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function resolveTime(expr: string, day: DateTime, iv: { open: DateTime; close: DateTime } | null): DateTime | null {
  const rel = expr.match(/^(open|close)([+-])(\d+)$/);
  if (rel) {
    if (!iv) return null;
    const base = rel[1] === "open" ? iv.open : iv.close;
    const minutes = Number(rel[3]) * (rel[2] === "+" ? 1 : -1);
    return base.plus({ minutes });
  }
  return day.set(parseHm(expr));
}

// One-minute steps: exact, and times never look scheduled.
const STEP_MINUTES = 1;

/** Every candidate send time (one-minute steps) for a window on one local day. */
export function windowCandidates(clock: ClinicClock, window: WindowRule, localDay: DateTime): DateTime[] {
  const day = localDay.setZone(clock.timezone).startOf("day");
  const iso = day.toISODate()!;
  if (clock.blackoutDates.includes(iso) || usFederalHolidays(day.year).has(iso)) return [];
  const weekday = WEEKDAY_BY_LUXON[day.weekday]!;
  const iv = openInterval(clock, day);
  const out: DateTime[] = [];
  for (const slot of window.slots) {
    if (!slot.days.includes(weekday)) continue;
    const from = resolveTime(slot.from, day, iv);
    const to = resolveTime(slot.to, day, iv);
    if (!from || !to || to <= from) continue;
    for (let t = from; t < to; t = t.plus({ minutes: STEP_MINUTES })) {
      const open = Boolean(iv && t >= iv.open && t < iv.close);
      if (window.clinic === "open" && !open) continue;
      if (window.clinic === "closed" && open) continue;
      out.push(t);
    }
  }
  return out;
}

export interface ScheduleRequest {
  scripts: { script: ScriptId; window: WindowRule }[];
  /** Earliest allowed send time. */
  notBefore: Date;
  minHoursBetween: number;
  /** Search this many days ahead for each inquiry before giving up. */
  horizonDays?: number;
}

/**
 * Picks a random send time for each inquiry, in order, inside its window and at
 * least `minHoursBetween` after the previous one. Returns null if any can't be placed.
 */
export function scheduleInquiries(clock: ClinicClock, req: ScheduleRequest, random: () => number): { script: ScriptId; at: Date }[] | null {
  const out: { script: ScriptId; at: Date }[] = [];
  let cursor: DateTime = DateTime.fromJSDate(req.notBefore).setZone(clock.timezone);
  const horizon = req.horizonDays ?? 21;
  for (const { script, window } of req.scripts) {
    let placed: DateTime | null = null;
    for (let i = 0; i < horizon && !placed; i++) {
      const candidates = windowCandidates(clock, window, cursor.startOf("day").plus({ days: i })).filter((t) => t >= cursor);
      if (candidates.length === 0) continue;
      // Sometimes skip the first usable day so tests don't always start on the same weekday.
      if (i === 0 && candidates.length > 0 && random() < 0.25 && out.length > 0) continue;
      placed = candidates[Math.floor(random() * candidates.length)]!;
    }
    if (!placed) return null;
    out.push({ script, at: placed.toJSDate() });
    cursor = placed.plus({ hours: req.minHoursBetween });
  }
  return out;
}
