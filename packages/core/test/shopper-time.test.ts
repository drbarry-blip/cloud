import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import {
  arrivalBusinessDay,
  businessMinutesBetween,
  DEFAULT_HOURS,
  isOpen,
  scheduleInquiries,
  seededRandom,
  usFederalHolidays,
  windowCandidates,
  type ClinicClock,
} from "../src/shopper";
import { playbook } from "./helpers";

const TZ = "America/Chicago";
const clock: ClinicClock = { timezone: TZ, hours: DEFAULT_HOURS, blackoutDates: [] };
const at = (iso: string) => DateTime.fromISO(iso, { zone: TZ }).toJSDate();

describe("usFederalHolidays", () => {
  it("computes 2026 observed dates", () => {
    expect([...usFederalHolidays(2026)].sort()).toEqual([
      "2026-01-01", "2026-01-19", "2026-02-16", "2026-05-25", "2026-06-19", "2026-07-03",
      "2026-09-07", "2026-10-12", "2026-11-11", "2026-11-26", "2026-12-25",
    ]);
  });
  it("observes New Year's Day on the previous Friday when it falls on Saturday", () => {
    expect(usFederalHolidays(2027).has("2027-12-31")).toBe(true); // Jan 1, 2028 is a Saturday
  });
});

describe("clinic clock", () => {
  it("knows when the clinic is open", () => {
    expect(isOpen(clock, at("2026-10-06T10:00"))).toBe(true); // Tuesday
    expect(isOpen(clock, at("2026-10-06T17:00"))).toBe(false); // closing time
    expect(isOpen(clock, at("2026-10-10T11:00"))).toBe(false); // Saturday
    expect(isOpen(clock, at("2026-10-12T11:00"))).toBe(false); // holiday
    expect(isOpen({ ...clock, blackoutDates: ["2026-10-06"] }, at("2026-10-06T10:00"))).toBe(false);
  });

  it("counts only open minutes, skipping weekends and holidays", () => {
    expect(businessMinutesBetween(clock, at("2026-10-02T16:30"), at("2026-10-05T09:30"))).toBe(60); // Fri -> Mon
    expect(businessMinutesBetween(clock, at("2026-10-09T16:30"), at("2026-10-13T09:30"))).toBe(60); // skips Columbus Day
    expect(businessMinutesBetween(clock, at("2026-10-06T19:00"), at("2026-10-06T21:00"))).toBe(0); // after hours
    expect(businessMinutesBetween(clock, at("2026-10-06T10:00"), at("2026-10-06T09:00"))).toBe(0);
  });

  it("finds the business day an inquiry arrives on", () => {
    expect(arrivalBusinessDay(clock, at("2026-10-02T10:00"))).toBe("2026-10-02");
    expect(arrivalBusinessDay(clock, at("2026-10-02T18:00"))).toBe("2026-10-05");
    expect(arrivalBusinessDay(clock, at("2026-10-02T07:00"))).toBe("2026-10-02");
  });
});

describe("windows and scheduling", () => {
  const windows = playbook.personaRules.timing.windows;

  it("keeps after-hours candidates to times the clinic is closed", () => {
    const tuesday = DateTime.fromISO("2026-10-06", { zone: TZ });
    expect(windowCandidates(clock, windows.after_hours!, tuesday)).toHaveLength(120);
    const lateClinic = { ...clock, hours: { ...DEFAULT_HOURS, tue: { open: "09:00", close: "20:00" } } };
    expect(windowCandidates(lateClinic, windows.after_hours!, tuesday)).toHaveLength(60);
  });

  it("resolves open/close-relative windows", () => {
    const tuesday = DateTime.fromISO("2026-10-06", { zone: TZ });
    const c = windowCandidates(clock, windows.business_hours!, tuesday);
    expect(c[0]!.toFormat("HH:mm")).toBe("10:00"); // open+60
    expect(c[c.length - 1]!.toFormat("HH:mm")).toBe("14:59"); // before close-120
  });

  it("schedules each persona inside its window, 24+ hours apart, reproducibly", () => {
    const scripts = playbook.personaRules.test_mix.baseline.map((s) => ({ script: s, window: windows[playbook.personaRules.scripts[s].window]! }));
    const req = { scripts, notBefore: at("2026-10-05T08:00"), minHoursBetween: 24 };
    const a = scheduleInquiries(clock, req, seededRandom(42))!;
    const b = scheduleInquiries(clock, req, seededRandom(42))!;
    expect(a).toEqual(b);
    expect(a.map((x) => x.script)).toEqual(["silent", "engaged", "price_check"]);
    expect(isOpen(clock, a[0]!.at)).toBe(true);
    expect(isOpen(clock, a[1]!.at)).toBe(false);
    expect(isOpen(clock, a[2]!.at)).toBe(true);
    for (let i = 1; i < a.length; i++) expect(a[i]!.at.getTime() - a[i - 1]!.at.getTime()).toBeGreaterThanOrEqual(24 * 3600_000);
  });

  it("returns null when a window can't be met (clinic never open)", () => {
    const closed: ClinicClock = { ...clock, hours: { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null } };
    const req = { scripts: [{ script: "silent" as const, window: windows.business_hours! }], notBefore: at("2026-10-05T08:00"), minHoursBetween: 24 };
    expect(scheduleInquiries(closed, req, seededRandom(1))).toBeNull();
  });
});
