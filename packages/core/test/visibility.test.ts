import { describe, expect, it } from "vitest";
import { median, percentileRank, scoreVisibility, type VisibilitySignals } from "../src";
import { playbook } from "./helpers";

const rules = playbook.visibilityScore;

const best: VisibilitySignals = {
  reputation: { rating: 4.9, reviewCount: 400, competitorRatings: [4.2, 4.5, 4.6], competitorReviewCounts: [50, 80, 120], newestReviewAgeDays: 3 },
  booking: { onlineBooking: true, tapToCall: true, contactForm: 4, textOrChat: true, newPatientCtaAboveFold: true },
  website: { pagespeedMobile: 95, coreWebVitalsPass: true, labLoadSeconds: 1.2, https: true, mobileViewport: true },
  profile: { hoursListed: true, websiteLinked: true, phoneListed: true, photoCount: 12 },
};

const worst: VisibilitySignals = {
  reputation: { rating: 3.6, reviewCount: 4, competitorRatings: [4.5, 4.6, 4.8], competitorReviewCounts: [50, 80, 120], newestReviewAgeDays: 400 },
  booking: { onlineBooking: false, tapToCall: false, contactForm: 9, textOrChat: false, newPatientCtaAboveFold: false },
  website: { pagespeedMobile: 20, coreWebVitalsPass: false, labLoadSeconds: 6, https: false, mobileViewport: false },
  profile: { hoursListed: false, websiteLinked: false, phoneListed: false, photoCount: 1 },
};

describe("scoreVisibility", () => {
  it("gives a perfect clinic 100 and no quick wins", () => {
    const r = scoreVisibility(best, rules);
    expect(r.total).toBe(100);
    expect(r.quickWins).toEqual([]);
  });

  it("gives a weak clinic a low score and three quick wins, biggest losses first", () => {
    const r = scoreVisibility(worst, rules);
    expect(r.total).toBeLessThan(10);
    expect(r.quickWins).toHaveLength(3);
    // Rating (15) and review count (15 - 3 = 12 lost) cost the most points.
    expect(r.quickWins[0]!.signalId).toBe("rating_vs_median");
  });

  it("drops unmeasured signals and re-weights within the pillar", () => {
    const signals: VisibilitySignals = { ...best, website: { ...best.website, pagespeedMobile: null } };
    const website = scoreVisibility(signals, rules).pillars.find((p) => p.id === "website_speed")!;
    expect(website.score).toBe(20);
    expect(website.signals.find((s) => s.id === "pagespeed_mobile")!.measured).toBe(false);
  });

  it("drops a whole pillar when nothing in it could be measured", () => {
    const signals: VisibilitySignals = {
      ...best,
      booking: { onlineBooking: null, tapToCall: null, contactForm: null, textOrChat: null, newPatientCtaAboveFold: null },
    };
    const r = scoreVisibility(signals, rules);
    expect(r.pillars.find((p) => p.id === "booking_ease")!.measured).toBe(false);
    expect(r.total).toBe(100);
  });

  it("treats an embedded form as unmeasured, but online booking as a pass", () => {
    const embedded = scoreVisibility({ ...best, booking: { ...best.booking, onlineBooking: false, contactForm: "embedded" } }, rules);
    expect(embedded.pillars[1]!.signals.find((s) => s.id === "short_contact_form")!.measured).toBe(false);
    const booking = scoreVisibility({ ...best, booking: { ...best.booking, contactForm: 12 } }, rules);
    expect(booking.pillars[1]!.signals.find((s) => s.id === "short_contact_form")!.points).toBe(5);
  });

  it("scores a clinic with no reviews as zero on rating and count", () => {
    const r = scoreVisibility({ ...best, reputation: { ...best.reputation, rating: null, reviewCount: 0, newestReviewAgeDays: null } }, rules);
    const rep = r.pillars[0]!;
    expect(rep.signals.filter((s) => s.measured).every((s) => s.points === 0)).toBe(true);
  });

  it("falls back to lab load time when there's no real-visitor data", () => {
    const r = scoreVisibility({ ...best, website: { ...best.website, coreWebVitalsPass: null, labLoadSeconds: 2.1 } }, rules);
    expect(r.pillars[2]!.signals.find((s) => s.id === "core_web_vitals")!.points).toBe(3);
  });
});

describe("helpers", () => {
  it("computes medians", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it("computes percentile rank with ties counted as half", () => {
    expect(percentileRank(10, [])).toBeNull();
    expect(percentileRank(100, [10, 20, 30, 40])).toBe(100);
    expect(percentileRank(20, [10, 20, 30, 40])).toBe(37.5);
  });
});
