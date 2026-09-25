import type { VisibilityScoreRules } from "../playbook/schema";

/** Raw measurements. `null` means "couldn't measure" and the signal is dropped and re-weighted. */
export interface VisibilitySignals {
  reputation: {
    rating: number | null;
    reviewCount: number | null;
    competitorRatings: number[];
    competitorReviewCounts: number[];
    newestReviewAgeDays: number | null;
  };
  booking: {
    onlineBooking: boolean | null;
    tapToCall: boolean | null;
    /** "none" = no form found; "embedded" = third-party form we can't count; number = field count. */
    contactForm: "none" | "embedded" | number | null;
    textOrChat: boolean | null;
    newPatientCtaAboveFold: boolean | null;
  };
  website: {
    pagespeedMobile: number | null;
    coreWebVitalsPass: boolean | null;
    labLoadSeconds: number | null;
    https: boolean | null;
    mobileViewport: boolean | null;
  };
  profile: {
    hoursListed: boolean | null;
    websiteLinked: boolean | null;
    phoneListed: boolean | null;
    photoCount: number | null;
  };
}

export type PillarId = "reputation" | "booking_ease" | "website_speed" | "profile_completeness";

export interface SignalResult {
  id: string;
  label: string;
  points: number;
  maxPoints: number;
  measured: boolean;
  detail: string;
}

export interface PillarResult {
  id: PillarId;
  label: string;
  /** Points after re-weighting unmeasured signals, on the pillar's own scale. */
  score: number;
  maxPoints: number;
  measured: boolean;
  signals: SignalResult[];
}

export interface VisibilityResult {
  total: number;
  pillars: PillarResult[];
  quickWins: { signalId: string; text: string }[];
}

const PILLAR_LABELS: Record<PillarId, string> = {
  reputation: "Reputation",
  booking_ease: "Booking ease",
  website_speed: "Website speed",
  profile_completeness: "Profile completeness",
};

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Percentile rank (0–100) of `value` among `others`, counting ties as half. */
export function percentileRank(value: number, others: readonly number[]): number | null {
  if (others.length === 0) return null;
  const below = others.filter((o) => o < value).length;
  const equal = others.filter((o) => o === value).length;
  return ((below + equal / 2) / others.length) * 100;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function unmeasured(id: string, label: string, maxPoints: number, detail: string): SignalResult {
  return { id, label, points: 0, maxPoints, measured: false, detail };
}

function yesNo(id: string, label: string, max: number, value: boolean | null, yes: string, no: string, unknown: string): SignalResult {
  if (value === null) return unmeasured(id, label, max, unknown);
  return { id, label, points: value ? max : 0, maxPoints: max, measured: true, detail: value ? yes : no };
}

function reputationSignals(s: VisibilitySignals["reputation"], r: VisibilityScoreRules["pillars"]["reputation"]["signals"]): SignalResult[] {
  const out: SignalResult[] = [];

  const rv = r.rating_vs_median;
  const med = median(s.competitorRatings);
  if (med === null) {
    out.push(unmeasured("rating_vs_median", "Rating vs. nearby competitors", rv.max_points, "No competitor ratings to compare against."));
  } else if (s.rating === null) {
    out.push({ id: "rating_vs_median", label: "Rating vs. nearby competitors", points: 0, maxPoints: rv.max_points, measured: true, detail: `No Google rating yet; nearby median is ${med.toFixed(1)}.` });
  } else {
    const diff = s.rating - med;
    const band = rv.bands.find((b) => b.min_diff === null || diff >= b.min_diff - 1e-9) ?? rv.bands[rv.bands.length - 1]!;
    out.push({ id: "rating_vs_median", label: "Rating vs. nearby competitors", points: band.points, maxPoints: rv.max_points, measured: true, detail: `${s.rating.toFixed(1)} stars vs. a nearby median of ${med.toFixed(1)} (${band.label.toLowerCase()}).` });
  }

  const rc = r.review_count_vs_competitors;
  if (s.reviewCount === null) {
    out.push(unmeasured("review_count_vs_competitors", "Review count vs. competitors", rc.max_points, "Review count unavailable."));
  } else if (s.reviewCount === 0) {
    out.push({ id: "review_count_vs_competitors", label: "Review count vs. competitors", points: rc.no_reviews_points, maxPoints: rc.max_points, measured: true, detail: "No Google reviews yet." });
  } else {
    const pct = percentileRank(s.reviewCount, s.competitorReviewCounts);
    if (pct === null) {
      out.push(unmeasured("review_count_vs_competitors", "Review count vs. competitors", rc.max_points, "No competitors to compare against."));
    } else {
      const band = rc.bands.find((b) => pct >= b.min_percentile) ?? rc.bands[rc.bands.length - 1]!;
      const med = median(s.competitorReviewCounts)!;
      out.push({ id: "review_count_vs_competitors", label: "Review count vs. competitors", points: band.points, maxPoints: rc.max_points, measured: true, detail: `${s.reviewCount} reviews vs. a nearby median of ${Math.round(med)} (${band.label.toLowerCase()}).` });
    }
  }

  const na = r.newest_review_age;
  if (s.newestReviewAgeDays === null) {
    out.push(unmeasured("newest_review_age", "Most recent review", na.max_points, "Google didn't return review dates."));
  } else {
    const days = s.newestReviewAgeDays;
    const band = na.bands.find((b) => b.max_days === null || days <= b.max_days) ?? na.bands[na.bands.length - 1]!;
    out.push({ id: "newest_review_age", label: "Most recent review", points: band.points, maxPoints: na.max_points, measured: true, detail: `Newest review is ${Math.round(days)} day${Math.round(days) === 1 ? "" : "s"} old.` });
  }
  return out;
}

function bookingSignals(s: VisibilitySignals["booking"], p: VisibilityScoreRules["pillars"]["booking_ease"]): SignalResult[] {
  const r = p.signals;
  const form = (): SignalResult => {
    const id = "short_contact_form";
    const label = "Short contact form";
    if (s.onlineBooking === true) return { id, label, points: r.short_contact_form, maxPoints: r.short_contact_form, measured: true, detail: "Online booking makes a long form less important." };
    if (s.contactForm === null || s.contactForm === "embedded") return unmeasured(id, label, r.short_contact_form, "The form is embedded from another service, so its fields couldn't be counted.");
    if (s.contactForm === "none") return { id, label, points: 0, maxPoints: r.short_contact_form, measured: true, detail: "No contact form found on the pages we checked." };
    const ok = s.contactForm <= p.short_form_max_fields;
    return { id, label, points: ok ? r.short_contact_form : 0, maxPoints: r.short_contact_form, measured: true, detail: `Contact form has ${s.contactForm} fields${ok ? "" : ` (aim for ${p.short_form_max_fields} or fewer)`}.` };
  };
  return [
    yesNo("online_booking_detected", "Online booking", r.online_booking_detected, s.onlineBooking, "Online booking found.", "No online booking tool found.", "Couldn't check the website."),
    yesNo("tap_to_call_on_mobile", "Tap-to-call on mobile", r.tap_to_call_on_mobile, s.tapToCall, "Phone number is tappable.", "Phone number isn't a tappable link.", "Couldn't check the website."),
    form(),
    yesNo("text_or_chat_option", "Text or chat option", r.text_or_chat_option, s.textOrChat, "Text or chat option found.", "No text or chat option found.", "Couldn't check the website."),
    yesNo("new_patient_button_above_fold", "Booking button near the top", r.new_patient_button_above_fold, s.newPatientCtaAboveFold, "A booking button appears near the top of the homepage.", "No booking button near the top of the homepage.", "Couldn't check the website."),
  ];
}

function websiteSignals(s: VisibilitySignals["website"], r: VisibilityScoreRules["pillars"]["website_speed"]["signals"]): SignalResult[] {
  const out: SignalResult[] = [];
  const ps = r.pagespeed_mobile;
  if (s.pagespeedMobile === null) {
    out.push(unmeasured("pagespeed_mobile", "Mobile speed score", ps.max_points, "Google PageSpeed couldn't test the site."));
  } else {
    const score = s.pagespeedMobile;
    const band = ps.bands.find((b) => score >= b.min_score) ?? ps.bands[ps.bands.length - 1]!;
    out.push({ id: "pagespeed_mobile", label: "Mobile speed score", points: band.points, maxPoints: ps.max_points, measured: true, detail: `Google PageSpeed mobile score: ${Math.round(score)}/100.` });
  }

  const cwv = r.core_web_vitals;
  if (s.coreWebVitalsPass !== null) {
    out.push({ id: "core_web_vitals", label: "Real-visitor experience", points: s.coreWebVitalsPass ? cwv.pass_points : 0, maxPoints: cwv.max_points, measured: true, detail: s.coreWebVitalsPass ? "Passes Google's Core Web Vitals for real visitors." : "Fails Google's Core Web Vitals for real visitors." });
  } else if (s.labLoadSeconds !== null) {
    const fb = cwv.no_field_data_fallback;
    const ok = s.labLoadSeconds <= fb.lab_load_seconds_max;
    out.push({ id: "core_web_vitals", label: "Real-visitor experience", points: ok ? fb.points : 0, maxPoints: cwv.max_points, measured: true, detail: `No real-visitor data yet; main content loads in ${s.labLoadSeconds.toFixed(1)}s in Google's test.` });
  } else {
    out.push(unmeasured("core_web_vitals", "Real-visitor experience", cwv.max_points, "No speed data available."));
  }

  const hm = r.https_and_mobile_layout;
  if (s.https === null || s.mobileViewport === null) {
    out.push(unmeasured("https_and_mobile_layout", "Secure and mobile-friendly", hm, "Couldn't check the website."));
  } else {
    const ok = s.https && s.mobileViewport;
    const missing = [!s.https && "HTTPS", !s.mobileViewport && "a mobile layout"].filter(Boolean).join(" and ");
    out.push({ id: "https_and_mobile_layout", label: "Secure and mobile-friendly", points: ok ? hm : 0, maxPoints: hm, measured: true, detail: ok ? "Uses HTTPS and a mobile layout." : `Missing ${missing}.` });
  }
  return out;
}

function profileSignals(s: VisibilitySignals["profile"], r: VisibilityScoreRules["pillars"]["profile_completeness"]["signals"]): SignalResult[] {
  const photos = s.photoCount === null
    ? unmeasured("photos_5_or_more", "5+ photos", r.photos_5_or_more, "Photo count unavailable.")
    : { id: "photos_5_or_more", label: "5+ photos", points: s.photoCount >= 5 ? r.photos_5_or_more : 0, maxPoints: r.photos_5_or_more, measured: true, detail: s.photoCount >= 5 ? "Has at least 5 photos." : `Only ${s.photoCount} photo${s.photoCount === 1 ? "" : "s"} found.` };
  return [
    yesNo("hours_listed", "Hours listed", r.hours_listed, s.hoursListed, "Hours are listed.", "No hours on the Google profile.", "Couldn't read the profile."),
    yesNo("website_linked", "Website linked", r.website_linked, s.websiteLinked, "Website is linked.", "No website on the Google profile.", "Couldn't read the profile."),
    yesNo("phone_listed", "Phone listed", r.phone_listed, s.phoneListed, "Phone number is listed.", "No phone number on the Google profile.", "Couldn't read the profile."),
    photos,
  ];
}

function pillar(id: PillarId, maxPoints: number, signals: SignalResult[]): PillarResult {
  const measured = signals.filter((s) => s.measured);
  const measuredMax = measured.reduce((a, s) => a + s.maxPoints, 0);
  const earned = measured.reduce((a, s) => a + s.points, 0);
  const score = measuredMax > 0 ? (earned / measuredMax) * maxPoints : 0;
  return { id, label: PILLAR_LABELS[id], score: round1(score), maxPoints, measured: measuredMax > 0, signals };
}

/** Scores a clinic's visibility. Pure: same signals and rules always give the same result. */
export function scoreVisibility(signals: VisibilitySignals, rules: VisibilityScoreRules, maxQuickWins = 3): VisibilityResult {
  const p = rules.pillars;
  const pillars = [
    pillar("reputation", p.reputation.max_points, reputationSignals(signals.reputation, p.reputation.signals)),
    pillar("booking_ease", p.booking_ease.max_points, bookingSignals(signals.booking, p.booking_ease)),
    pillar("website_speed", p.website_speed.max_points, websiteSignals(signals.website, p.website_speed.signals)),
    pillar("profile_completeness", p.profile_completeness.max_points, profileSignals(signals.profile, p.profile_completeness.signals)),
  ];
  const measured = pillars.filter((x) => x.measured);
  const measuredMax = measured.reduce((a, x) => a + x.maxPoints, 0);
  const total = measuredMax > 0 ? Math.round((measured.reduce((a, x) => a + x.score, 0) / measuredMax) * 100) : 0;

  const quickWins = pillars
    .flatMap((x) => x.signals)
    .filter((s) => s.measured && s.points < s.maxPoints && rules.quick_wins[s.id])
    .sort((a, b) => b.maxPoints - b.points - (a.maxPoints - a.points))
    .slice(0, maxQuickWins)
    .map((s) => ({ signalId: s.id, text: rules.quick_wins[s.id]! }));

  return { total, pillars, quickWins };
}
