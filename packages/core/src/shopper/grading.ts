import type { Criterion, ResponseStandards, Rubric, ScriptId } from "../playbook/shopper-schema";
import { findObservations, hasLink, hasPhoneNumber, isHumanTouch, type Observation, type TouchChannel, type TouchLabel } from "./classify";
import { arrivalBusinessDay, businessMinutesBetween, isOpen, localDate, nextBusinessDayAfter, type ClinicClock } from "./time";

export interface GradedTouch {
  id: string;
  channel: TouchChannel;
  at: Date;
  label: TouchLabel;
  /** Email body, text message, or voicemail transcript. */
  text?: string;
  /** For calls: whether a voicemail was left. */
  voicemail?: boolean;
  /** Arrived after the observation window closed; logged but not scored. */
  late: boolean;
}

export interface GradedPersona {
  id: string;
  script: ScriptId;
  channel: "web_form" | "email";
  sentAt: Date | null;
  sensitive: boolean;
  touches: GradedTouch[];
  /** When the persona's follow-up (question or objection) was sent, if any. */
  followUpSentAt?: Date | null;
}

export interface QualityJudgement {
  touchId: string;
  criterionId: string;
  met: boolean;
  quote: string | null;
}

export interface GradeInput {
  rubric: Rubric;
  standards: ResponseStandards;
  clock: ClinicClock;
  clinicName: string;
  personas: GradedPersona[];
  /** AI judgements per touch and criterion. Touches without them are graded by heuristics. */
  judgements?: QualityJudgement[];
  /** Treatment words that shouldn't appear in voicemails or texts for sensitive services. */
  sensitiveTerms?: readonly string[];
}

export interface Evidence {
  touchId: string;
  met: boolean;
  quote: string | null;
}

export interface CriterionResult {
  id: string;
  part: "conversation_quality" | "reachability";
  points: number;
  maxPoints: number;
  applicable: boolean;
  evidence: Evidence[];
  fix: string;
}

export interface PersonaResult {
  id: string;
  script: ScriptId;
  channel: "web_form" | "email";
  sentAt: Date | null;
  firstHumanAt: Date | null;
  firstHumanChannel: TouchChannel | null;
  businessMinutes: number | null;
  speedPoints: number;
  speedBand: string;
  humanTouches: number;
  distinctDays: number;
  channelsUsed: TouchChannel[];
  persistencePoints: number | null;
}

export type PartId = "speed" | "persistence" | "conversation_quality" | "reachability";

export interface GradeResult {
  total: number;
  grade: "A" | "B" | "C" | "D" | "F";
  parts: { id: PartId; label: string; points: number; maxPoints: number; note: string | null }[];
  personas: PersonaResult[];
  criteria: CriterionResult[];
  fixes: { id: string; text: string; lostPoints: number }[];
  observations: Observation[];
  headline: string;
  method: "ai" | "heuristic" | "mixed";
  needsReview: boolean;
}

const PART_LABELS: Record<PartId, string> = {
  speed: "Speed",
  persistence: "Persistence",
  conversation_quality: "Conversation quality",
  reachability: "Reachability",
};

const round1 = (n: number) => Math.round(n * 10) / 10;
const scored = (t: GradedTouch) => !t.late && isHumanTouch(t.label);

// ---------- Heuristic judgements (used when AI judgements are missing) ----------

const H = {
  answered: /\$|\bprice|\bcost|\bavailab|\bopening|\binsurance|\bconsult|\bappointment|\bvisit|\bprogram|\binclude|\blabs?\b|\btelehealth|\bdowntime|\breferral/i,
  askedForAppointment:
    /\b(?:would you like|want me to|can i|could i|shall (?:i|we)|let(?:'|’)s|happy to|i can)\b[^.?!]{0,50}\b(?:book|schedule|reserve|hold|set (?:you )?up|get you in)\b|\b(?:book|schedule)\b[^.?!]{0,30}\b(?:appointment|consult(?:ation)?|visit|time)\b|\bdo(?:es)? [^.?!]{0,30}\b(?:work for you|fit your schedule)\b/i,
  times: /\b\d{1,2}(?::\d{2})?\s?(?:am|pm|a\.m\.|p\.m\.)|\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow)\b/i,
  price: /\$\s?\d|\b\d+\s?(?:dollars|per (?:unit|month|session|syringe|visit|area))\b/i,
  objection: /\bpayment plan|\bfinanc|\bmembership|\bpackage|\bspecial\b|\bpromo|\bdiscount|\bsmaller|\bstart with|\bmonthly option|\bcarecredit|\bcherry\b|\bsplit\b/i,
  greeting: /\b(?:hi|hello|hey|dear|good (?:morning|afternoon|evening)|thanks|thank you)\b/i,
  sloppy: /\b(?:u|ur|pls|thx)\b/i,
  vmName: /\b(?:this is|my name is|it(?:'|’)s)\s+[a-z]+/i,
  vmNextStep: /\b(?:call|text|book|schedule|reach (?:me|us))\b/i,
};

function heuristic(criterionId: string, touch: GradedTouch, clinicName: string): Evidence {
  const text = touch.text ?? "";
  const quote = (re: RegExp) => text.match(re)?.[0] ?? null;
  const ev = (met: boolean, q: string | null = null): Evidence => ({ touchId: touch.id, met, quote: met ? q : null });
  switch (criterionId) {
    case "answered_question":
      return ev(text.length >= 60 && H.answered.test(text), quote(H.answered));
    case "asked_for_appointment":
      return ev(H.askedForAppointment.test(text), quote(H.askedForAppointment));
    case "easy_booking":
      return ev(hasLink(text) || H.times.test(text), quote(/\bhttps?:\/\/\S+/i) ?? quote(H.times));
    case "price_clarity":
      return ev(H.price.test(text), quote(H.price));
    case "objection_handling":
      return ev(H.objection.test(text), quote(H.objection));
    case "tone":
      return ev(text.length >= 20 && H.greeting.test(text) && !H.sloppy.test(text), quote(H.greeting));
    case "voicemail_quality": {
      const clinicWord = clinicName.split(/\s+/)[0]?.toLowerCase() ?? "";
      const parts = [H.vmName.test(text), clinicWord.length > 2 && text.toLowerCase().includes(clinicWord), hasPhoneNumber(text), H.vmNextStep.test(text)];
      return ev(parts.filter(Boolean).length >= 3, text.slice(0, 120) || null);
    }
    case "direct_path":
      return ev(hasLink(text) || hasPhoneNumber(text), quote(/\bhttps?:\/\/\S+/i) ?? (hasPhoneNumber(text) ? "phone number" : null));
    default:
      return ev(false);
  }
}

// ---------- Scoring ----------

function speedFor(input: GradeInput, p: GradedPersona): Pick<PersonaResult, "firstHumanAt" | "firstHumanChannel" | "businessMinutes" | "speedPoints" | "speedBand"> {
  const { speed } = input.rubric.parts;
  const human = p.touches.filter(scored).sort((a, b) => a.at.getTime() - b.at.getTime());
  const first = human[0];
  const neverBand = speed.bands.find((b) => "rule" in b && b.rule === "never");
  if (!p.sentAt || !first) return { firstHumanAt: null, firstHumanChannel: null, businessMinutes: null, speedPoints: neverBand?.points ?? 0, speedBand: neverBand?.label ?? "Never" };

  const bm = businessMinutesBetween(input.clock, p.sentAt, first.at);
  const arrival = arrivalBusinessDay(input.clock, p.sentAt);
  const responseDay = localDate(input.clock, first.at);
  const next = arrival ? nextBusinessDayAfter(input.clock, arrival) : null;
  let band = speed.bands[speed.bands.length - 1]!;
  for (const b of speed.bands) {
    if ("max_business_minutes" in b) {
      if (bm <= b.max_business_minutes) { band = b; break; }
    } else if (b.rule === "same_business_day") {
      if (arrival && responseDay <= arrival) { band = b; break; }
    } else if (b.rule === "next_business_day") {
      if (next && responseDay <= next) { band = b; break; }
    } else if (b.rule === "later") {
      band = b;
      break;
    }
  }
  let points = band.points;
  // After-hours bonus: an instant auto-reply with a booking link.
  if (!isOpen(input.clock, p.sentAt)) {
    const instant = p.touches.some((t) => t.label === "auto_reply" && hasLink(t.text) && t.at.getTime() - p.sentAt!.getTime() <= 10 * 60_000);
    if (instant) points = Math.min(speed.after_hours_bonus.cap, points + speed.after_hours_bonus.points);
  }
  return { firstHumanAt: first.at, firstHumanChannel: first.channel, businessMinutes: bm, speedPoints: points, speedBand: band.label };
}

function persistenceFor(input: GradeInput, p: GradedPersona): { points: number; humanTouches: number; distinctDays: number; channels: TouchChannel[] } {
  const { persistence } = input.rubric.parts;
  const human = p.touches.filter(scored);
  const days = new Set(human.map((t) => localDate(input.clock, t.at)));
  const channels = [...new Set(human.map((t) => t.channel))];
  const band = persistence.bands.find((b) => human.length >= b.min_touches && (b.max_touches === null || human.length <= b.max_touches)) ?? persistence.bands[0]!;
  let points = band.points;
  const f = input.standards.follow_up;
  if (days.size >= f.minimum_distinct_days && channels.length >= f.minimum_channels) {
    points = Math.min(persistence.spread_bonus.cap, points + persistence.spread_bonus.points);
  }
  return { points, humanTouches: human.length, distinctDays: days.size, channels };
}

function applicableTouches(c: Criterion, part: "conversation_quality" | "reachability", personas: GradedPersona[]): GradedTouch[] {
  const out: GradedTouch[] = [];
  for (const p of personas) {
    if (!p.sentAt) continue;
    if (c.applies_to && !c.applies_to.includes(p.script)) continue;
    for (const t of p.touches) {
      if (!scored(t)) continue;
      if (c.id === "voicemail_quality") {
        if (t.channel === "call" && t.voicemail && t.text) out.push(t);
        continue;
      }
      if (!t.text) continue;
      if (c.id === "price_clarity" && p.script !== "price_check") continue;
      if (c.id === "objection_handling" && (!p.followUpSentAt || t.at <= p.followUpSentAt)) continue;
      if (part === "conversation_quality" || c.id === "direct_path") out.push(t);
    }
  }
  return out;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function formatBusinessMinutes(minutes: number): string {
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))} minutes`;
  const hours = minutes / 60;
  if (hours < 8) return `${round1(hours)} business hours`;
  const days = hours / 8;
  return `about ${Math.round(days)} business day${Math.round(days) === 1 ? "" : "s"}`;
}

export function gradeTest(input: GradeInput): GradeResult {
  const { rubric } = input;
  const sent = input.personas.filter((p) => p.sentAt);
  const judgements = new Map((input.judgements ?? []).map((j) => [`${j.touchId}:${j.criterionId}`, j]));
  let usedAi = false;
  let usedHeuristic = false;

  // Speed and persistence per persona.
  const counted = sent.some((p) => rubric.parts.persistence.counted_for.includes(p.script))
    ? new Set(rubric.parts.persistence.counted_for)
    : new Set(sent.map((p) => p.script)); // retests without a Silent persona
  const personas: PersonaResult[] = input.personas.map((p) => {
    const speed = speedFor(input, p);
    const pers = persistenceFor(input, p);
    return {
      id: p.id,
      script: p.script,
      channel: p.channel,
      sentAt: p.sentAt,
      ...speed,
      humanTouches: pers.humanTouches,
      distinctDays: pers.distinctDays,
      channelsUsed: pers.channels,
      persistencePoints: p.sentAt && counted.has(p.script) ? pers.points : null,
    };
  });
  const sentResults = personas.filter((p) => p.sentAt);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const speedPoints = avg(sentResults.map((p) => p.speedPoints));
  const persistenceScores = sentResults.flatMap((p) => (p.persistencePoints === null ? [] : [p.persistencePoints]));
  const persistencePoints = avg(persistenceScores);

  // Criteria for quality and reachability.
  const criteria: CriterionResult[] = [];
  for (const part of ["conversation_quality", "reachability"] as const) {
    for (const c of rubric.parts[part].criteria) {
      if (c.id === "channel_match") {
        const evidence: Evidence[] = sent.map((p) => {
          const human = p.touches.filter(scored);
          const met = p.channel === "email" ? human.some((t) => t.channel === "email") : human.length > 0;
          return { touchId: p.id, met, quote: met ? `Replied by ${[...new Set(human.map((t) => t.channel))].join(" and ")}` : null };
        });
        const frac = evidence.length ? evidence.filter((e) => e.met).length / evidence.length : 0;
        criteria.push({ id: c.id, part, points: round1(frac * c.points), maxPoints: c.points, applicable: evidence.length > 0, evidence, fix: c.fix });
        continue;
      }
      const touches = applicableTouches(c, part, sent);
      const evidence = touches.map((t) => {
        const j = judgements.get(`${t.id}:${c.id}`);
        if (j) {
          usedAi = true;
          return { touchId: t.id, met: j.met, quote: j.quote };
        }
        usedHeuristic = true;
        return heuristic(c.id, t, input.clinicName);
      });
      const frac = evidence.length ? evidence.filter((e) => e.met).length / evidence.length : 0;
      criteria.push({ id: c.id, part, points: round1(frac * c.points), maxPoints: c.points, applicable: evidence.length > 0, evidence, fix: c.fix });
    }
  }

  const partPoints = (part: "conversation_quality" | "reachability") => {
    const cs = criteria.filter((c) => c.part === part && c.applicable);
    const max = cs.reduce((a, c) => a + c.maxPoints, 0);
    if (max === 0) return { points: 0, scale: 0 };
    const scale = rubric.parts[part].max_points / max;
    return { points: cs.reduce((a, c) => a + c.points, 0) * scale, scale };
  };
  const quality = partPoints("conversation_quality");
  const reach = partPoints("reachability");
  const anyWritten = criteria.some((c) => c.part === "conversation_quality" && c.applicable);

  const parts: GradeResult["parts"] = [
    { id: "speed", label: PART_LABELS.speed, points: round1(speedPoints), maxPoints: rubric.parts.speed.max_points, note: null },
    { id: "persistence", label: PART_LABELS.persistence, points: round1(persistencePoints), maxPoints: rubric.parts.persistence.max_points, note: null },
    {
      id: "conversation_quality",
      label: PART_LABELS.conversation_quality,
      points: round1(quality.points),
      maxPoints: rubric.parts.conversation_quality.max_points,
      note: anyWritten ? null : "No written replies or voicemails to evaluate.",
    },
    { id: "reachability", label: PART_LABELS.reachability, points: round1(reach.points), maxPoints: rubric.parts.reachability.max_points, note: null },
  ];
  const total = Math.round(parts.reduce((a, p) => a + p.points, 0));
  const g = rubric.grades;
  const grade = total >= g.A ? "A" : total >= g.B ? "B" : total >= g.C ? "C" : total >= g.D ? "D" : "F";

  // Fixes ranked by points lost.
  const fixes = [
    { id: "speed", text: rubric.parts.speed.fix, lostPoints: rubric.parts.speed.max_points - speedPoints },
    { id: "persistence", text: rubric.parts.persistence.fix, lostPoints: persistenceScores.length ? rubric.parts.persistence.max_points - persistencePoints : 0 },
    ...criteria
      .filter((c) => c.applicable)
      .map((c) => ({ id: c.id, text: c.fix, lostPoints: (c.maxPoints - c.points) * (c.part === "conversation_quality" ? quality.scale : reach.scale) })),
  ]
    .filter((f) => f.lostPoints > 0.5)
    .sort((a, b) => b.lostPoints - a.lostPoints)
    .slice(0, 3)
    .map((f) => ({ ...f, lostPoints: round1(f.lostPoints) }));

  // Worth-a-look notes.
  const observations: Observation[] = [];
  for (const p of sent) {
    for (const t of p.touches) {
      if (t.late) continue;
      observations.push(...findObservations(t.channel, t.text));
      if (p.sensitive && (t.channel === "sms" || (t.channel === "call" && t.voicemail)) && t.text) {
        const term = (input.sensitiveTerms ?? []).find((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t.text!));
        if (term) observations.push({ id: "sensitive_details_in_voicemail_or_text", quote: term });
      }
    }
  }
  const uniqueObs = observations.filter((o, i) => observations.findIndex((x) => x.id === o.id && x.quote === o.quote) === i);

  // Headline.
  const noReply = sentResults.filter((p) => !p.firstHumanAt).length;
  const replied = sentResults.filter((p) => p.businessMinutes !== null);
  const topBand = rubric.parts.speed.bands[0]!;
  const fastLimit = "max_business_minutes" in topBand ? topBand.max_business_minutes : 60;
  const silent = sentResults.find((p) => p.script === "silent");
  let headline: string;
  if (sentResults.length === 0) headline = "No inquiries could be sent, so there's nothing to grade yet.";
  else if (noReply > 0) headline = `${noReply} of ${sentResults.length} new-patient inquir${sentResults.length === 1 ? "y" : "ies"} never got a reply from a person.`;
  else if (median(replied.map((p) => p.businessMinutes!)) > fastLimit)
    headline = `A person first replied after ${formatBusinessMinutes(median(replied.map((p) => p.businessMinutes!)))} on a typical inquiry.`;
  else if (silent && silent.humanTouches < input.standards.follow_up.minimum_human_touches)
    headline = `Fast first replies, but follow-up stopped after ${silent.humanTouches} attempt${silent.humanTouches === 1 ? "" : "s"}.`;
  else headline = "Strong follow-up: fast replies and steady persistence.";

  const method = usedAi && usedHeuristic ? "mixed" : usedAi ? "ai" : "heuristic";
  return { total, grade, parts, personas, criteria, fixes, observations: uniqueObs, headline, method, needsReview: method !== "ai" };
}
