import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { classifyTouch, DEFAULT_HOURS, findObservations, gradeTest, planPersonas, renderFixItKit, seededRandom, type GradedPersona, type GradedTouch, type QualityJudgement } from "../src/shopper";
import { playbook } from "./helpers";

const TZ = "America/Chicago";
const at = (iso: string) => DateTime.fromISO(iso, { zone: TZ }).toJSDate();
const clock = { timezone: TZ, hours: DEFAULT_HOURS, blackoutDates: [] };
let n = 0;
const touch = (channel: GradedTouch["channel"], iso: string, text?: string, extra: Partial<GradedTouch> = {}): GradedTouch => ({
  id: `t${++n}`,
  channel,
  at: at(iso),
  label: classifyTouch({ channel, text }),
  text,
  late: false,
  ...extra,
});

const GOOD_EMAIL = "Hi Jess! Thanks for reaching out. A first visit is $150 and includes labs. Would you like to book a consult? I have Thursday at 2pm, or grab a time here: https://book.example.com/glow";
const GOOD_VM = "Hi Jess, this is Sam from Glow Clinic returning your request. Call or text me at 512-555-0100, again 512-555-0100. Talk soon!";

function scenario(): GradedPersona[] {
  return [
    {
      id: "silent",
      script: "silent",
      channel: "web_form",
      sentAt: at("2026-10-06T10:00"),
      sensitive: false,
      touches: [
        touch("call", "2026-10-06T10:40", GOOD_VM, { voicemail: true }),
        touch("email", "2026-10-06T11:00", GOOD_EMAIL),
        touch("sms", "2026-10-07T09:30", "Hi Jess, it's Sam at Glow. I have Thu 2pm or Fri 10am open. Want one? https://book.example.com/glow"),
        touch("call", "2026-10-08T15:00"),
        touch("email", "2026-10-12T10:00", "Hi Jess, checking in. Would you like to schedule a visit? https://book.example.com/glow"),
        touch("email", "2026-10-20T10:00", "late follow-up", { late: true }),
      ],
    },
    {
      id: "engaged",
      script: "engaged",
      channel: "email",
      sentAt: at("2026-10-07T19:30"),
      sensitive: false,
      touches: [
        touch("email", "2026-10-07T19:31", "Thank you for contacting Glow! We have received your message. Book anytime: https://book.example.com/glow"),
        touch("email", "2026-10-08T09:20", GOOD_EMAIL),
      ],
    },
    { id: "price", script: "price_check", channel: "web_form", sentAt: at("2026-10-09T14:00"), sensitive: false, touches: [] },
  ];
}

const base = () => ({ rubric: playbook.secretShopperRubric, standards: playbook.responseStandards, clock, clinicName: "Glow Clinic" });

describe("gradeTest", () => {
  it("scores speed on the business-hours clock, with the after-hours auto-reply bonus", () => {
    const r = gradeTest({ ...base(), personas: scenario() });
    const [silent, engaged, price] = r.personas;
    expect(silent!.businessMinutes).toBe(40);
    expect(silent!.speedPoints).toBe(35);
    expect(engaged!.businessMinutes).toBe(20); // 19:30 -> 9:20 next day = 20 business minutes
    expect(engaged!.speedPoints).toBe(35); // already full; bonus capped
    expect(price!.speedPoints).toBe(0);
    expect(price!.speedBand).toBe("Never");
  });

  it("counts persistence for the Silent persona, ignoring auto-replies and late touches", () => {
    const r = gradeTest({ ...base(), personas: scenario() });
    const silent = r.personas[0]!;
    expect(silent.humanTouches).toBe(5);
    expect(silent.distinctDays).toBe(4);
    expect(silent.persistencePoints).toBe(25); // 22 + 3 spread bonus
    expect(r.personas[1]!.persistencePoints).toBeNull(); // not counted for engaged
  });

  it("leads with the inquiry that never got a reply, and ranks fixes by lost points", () => {
    const r = gradeTest({ ...base(), personas: scenario() });
    expect(r.headline).toBe("1 of 3 new-patient inquiries never got a reply from a person.");
    expect(r.fixes[0]!.id).toBe("speed");
    expect(r.fixes.every((f, i, all) => i === 0 || all[i - 1]!.lostPoints >= f.lostPoints)).toBe(true);
    expect(["A", "B", "C", "D", "F"]).toContain(r.grade);
    expect(r.total).toBe(Math.round(r.parts.reduce((a, p) => a + p.points, 0)));
  });

  it("uses heuristics when there are no AI judgements, and flags the report for review", () => {
    const r = gradeTest({ ...base(), personas: scenario() });
    expect(r.method).toBe("heuristic");
    expect(r.needsReview).toBe(true);
    const asked = r.criteria.find((c) => c.id === "asked_for_appointment")!;
    expect(asked.evidence.some((e) => e.met && e.quote)).toBe(true);
    const vm = r.criteria.find((c) => c.id === "voicemail_quality")!;
    expect(vm.applicable).toBe(true);
    expect(vm.points).toBe(vm.maxPoints);
  });

  it("uses AI judgements when present for every touch", () => {
    const personas = scenario();
    const heuristic = gradeTest({ ...base(), personas });
    const judgements: QualityJudgement[] = heuristic.criteria.flatMap((c) =>
      c.id === "channel_match" ? [] : c.evidence.map((e) => ({ touchId: e.touchId, criterionId: c.id, met: true, quote: "quoted" })),
    );
    const r = gradeTest({ ...base(), personas, judgements });
    expect(r.method).toBe("ai");
    expect(r.needsReview).toBe(false);
  });

  it("drops price and objection criteria that don't apply and rescales quality", () => {
    const r = gradeTest({ ...base(), personas: scenario() });
    expect(r.criteria.find((c) => c.id === "price_clarity")!.applicable).toBe(false);
    expect(r.criteria.find((c) => c.id === "objection_handling")!.applicable).toBe(false);
    const quality = r.parts.find((p) => p.id === "conversation_quality")!;
    expect(quality.points).toBeLessThanOrEqual(quality.maxPoints);
  });

  it("gives zero quality when there's nothing written to evaluate", () => {
    const personas: GradedPersona[] = [{ id: "s", script: "silent", channel: "web_form", sentAt: at("2026-10-06T10:00"), sensitive: false, touches: [touch("call", "2026-10-06T11:00")] }];
    const r = gradeTest({ ...base(), personas });
    const q = r.parts.find((p) => p.id === "conversation_quality")!;
    expect(q.points).toBe(0);
    expect(q.note).toMatch(/No written replies/);
  });

  it("notes sensitive services named in a voicemail", () => {
    const personas: GradedPersona[] = [
      { id: "s", script: "silent", channel: "web_form", sentAt: at("2026-10-06T10:00"), sensitive: true, touches: [touch("call", "2026-10-06T11:00", "Hi, calling about your testosterone consult. Call 512-555-0100.", { voicemail: true })] },
    ];
    const r = gradeTest({ ...base(), personas, sensitiveTerms: ["testosterone"] });
    expect(r.observations).toContainEqual({ id: "sensitive_details_in_voicemail_or_text", quote: "testosterone" });
  });
});

describe("classifyTouch and observations", () => {
  it("labels auto-replies, marketing, reminders, and personal replies", () => {
    expect(classifyTouch({ channel: "email", subject: "Automatic reply: New patient question" })).toBe("auto_reply");
    expect(classifyTouch({ channel: "email", text: "This is an automated message. Do not reply." })).toBe("auto_reply");
    expect(classifyTouch({ channel: "email", text: "Hi!", headers: { "auto-submitted": "auto-replied" } })).toBe("auto_reply");
    expect(classifyTouch({ channel: "email", text: "Special offer: 20% off! https://a.example https://b.example Unsubscribe" })).toBe("marketing");
    expect(classifyTouch({ channel: "sms", text: "Appointment reminder: Tue 3pm. Reply C to confirm" })).toBe("reminder");
    expect(classifyTouch({ channel: "email", text: "Hi Jess, happy to help. When works for you?" })).toBe("personal");
    expect(classifyTouch({ channel: "call" })).toBe("personal");
  });

  it("finds unsupported claims and sensitive requests", () => {
    expect(findObservations("email", "Results are guaranteed or your money back.")[0]!.id).toBe("unsupported_claims");
    expect(findObservations("email", "Please send a photo of your insurance card before the visit.")[0]!.id).toBe("sensitive_info_by_plain_message");
  });
});

describe("planPersonas", () => {
  it("matches persona sex to the service and keeps addresses unique", () => {
    const clinicType = playbook.clinicTypes.hormone_weight_loss!;
    const plans = planPersonas(seededRandom(7), {
      clinicType,
      scripts: ["silent", "engaged", "price_check"],
      serviceIds: ["trt", "menopause_hormone_therapy", "medical_weight_loss"],
      domains: ["mail.example.com"],
      takenEmails: new Set(),
    });
    expect(plans).toHaveLength(3);
    expect(new Set(plans.map((p) => p.email)).size).toBe(3);
    expect(new Set(plans.map((p) => p.serviceId)).size).toBe(3);
    for (const p of plans) {
      if (p.serviceId === "trt") expect(p.sex).toBe("male");
      if (p.serviceId === "menopause_hormone_therapy") expect(p.sex).toBe("female");
      expect(p.email).toMatch(/^[a-z]+\.[a-z]+\d{2}@mail\.example\.com$/);
      expect(p.message.endsWith(p.firstName)).toBe(true);
    }
  });
});

describe("renderFixItKit", () => {
  it("fills every placeholder and keeps sensitive services generic", () => {
    const kit = renderFixItKit(playbook.fixItScripts, {
      clinicName: "Glow Clinic",
      callbackNumber: "512-555-0100",
      service: { name: "Testosterone replacement therapy (TRT)", sensitive: true, priceFactor: "your labs", smallerOption: "a consult" },
    });
    for (const s of kit.scripts) expect(s.text).not.toMatch(/\{\w+\}/);
    expect(kit.scripts.find((s) => s.id === "voicemail")!.text).toContain("your consultation request");
    expect(kit.scripts.find((s) => s.id === "voicemail")!.text).not.toMatch(/testosterone/i);
    expect(kit.cadence.length).toBeGreaterThan(0);
  });
});
