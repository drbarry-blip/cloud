import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShopperDeps } from "@/lib/shopper/deps";
import { runShopperTick } from "@/lib/shopper/engine";
import type { FormBot } from "@/lib/shopper/form-bot";
import { reviveReport } from "@/lib/shopper/grade";
import { recordCallDetails, recordCallStart, recordInboundEmail, recordSms, recordTranscript } from "@/lib/shopper/inbound";
import { checkPersonaReply, sendPersonaReply, templateReply } from "@/lib/shopper/persona-reply";
import { confirmBuyer, handleOrderPaid } from "@/lib/shopper/purchase";
import type { Assignment } from "@/lib/shopper/repo";
import { DAY, HOUR, makeDeps, placeOrder } from "./shopper-helpers";

afterEach(() => vi.restoreAllMocks());

const okBot: FormBot = {
  submit: async () => ({ status: "submitted", confirmation: "Thanks! We'll be in touch.", filled: ["first_name", "email", "message"], screenshots: [{ kind: "form_before", png: new Uint8Array([1, 2, 3]) }] }),
};

/** A scheduled baseline test with numbers in the pool for every persona. */
async function scheduledTest(over: Partial<ShopperDeps> = {}) {
  const ctx = await makeDeps({ formBot: okBot, ...over });
  for (const n of ["+15125550101", "+15125550102", "+15125550103"]) await ctx.repo.addNumber(n);
  const { orderId } = await placeOrder(ctx.deps);
  await handleOrderPaid(ctx.deps, orderId);
  await confirmBuyer(ctx.deps, orderId);
  const test = (await ctx.repo.testForOrder(orderId))!;
  const personas = await ctx.repo.assignmentsForTest(test.id);
  return { ...ctx, test, personas, byScript: (s: Assignment["script"]) => personas.find((p) => p.script === s)! };
}

describe("sending inquiries", () => {
  it("sends each inquiry at its time: forms by the bot, email from the persona's own address", async () => {
    const { deps, repo, clock, sent, test, byScript } = await scheduledTest();
    const silent = byScript("silent");
    const engaged = byScript("engaged");

    clock.now = new Date(silent.scheduledAt.getTime() - 60_000);
    expect(await runShopperTick(deps)).toMatchObject({ sent: 0 });
    clock.now = new Date(silent.scheduledAt.getTime() + 60_000);
    expect(await runShopperTick(deps)).toMatchObject({ sent: 1, toVa: 0 });

    const afterSilent = (await repo.getAssignment(silent.id))!;
    expect(afterSilent.sendStatus).toBe("sent");
    expect(afterSilent.observeUntil!.getTime()).toBe(clock.now.getTime() + 10 * DAY);
    expect(afterSilent.lateUntil!.getTime()).toBe(clock.now.getTime() + 14 * DAY);
    expect((await repo.getTest(test.id))!.status).toBe("running");
    const [inquiry] = await repo.outboundForTest(test.id);
    expect(inquiry).toMatchObject({ kind: "inquiry", channel: "web_form", sentBy: "bot", body: silent.message });
    expect(inquiry!.evidence.form_before).toMatch(/^[0-9a-f-]{36}$/);

    clock.now = new Date(engaged.scheduledAt.getTime() + 60_000);
    await runShopperTick(deps);
    const mail = sent.find((m) => m.to === "hello@glowclinic.example")!;
    expect(mail.from).toBe(`${engaged.firstName} ${engaged.lastName} <${engaged.email}>`);
    expect(mail.replyTo).toBeNull();
    expect(mail.html).toBeUndefined(); // plain text, no tracking
    expect(mail.headers!["Message-ID"]).toMatch(/^<[0-9a-f-]+@personas\.example\.net>$/);
    expect(mail.text).toBe(engaged.message);
  });

  it("hands forms to a VA when there's no browser or the bot can't finish", async () => {
    const failing: FormBot = { submit: async () => ({ status: "needs_va", reason: "The form has a CAPTCHA, so a person needs to submit it." }) };
    const { deps, repo, clock, byScript } = await scheduledTest({ formBot: failing });
    const silent = byScript("silent");
    clock.now = new Date(silent.scheduledAt.getTime() + 60_000);
    expect(await runShopperTick(deps)).toMatchObject({ sent: 0, toVa: 1 });
    expect((await repo.getAssignment(silent.id))!.sendStatus).toBe("needs_va");
    const task = (await repo.openTaskFor("submit_form", { assignmentId: silent.id }))!;
    expect(task.payload.reason).toMatch(/CAPTCHA/);
    expect(task.dueAt!.getTime()).toBe(clock.now.getTime() + 2 * HOUR);
  });

  it("rescues an inquiry stuck mid-send without sending it twice", async () => {
    const { deps, repo, clock, byScript } = await scheduledTest();
    const silent = byScript("silent");
    await repo.claimAssignment(silent.id);
    clock.now = new Date(silent.scheduledAt.getTime() + 20 * 60_000);
    expect(await runShopperTick(deps)).toMatchObject({ rescued: 1, sent: 0 });
    expect((await repo.getAssignment(silent.id))!.sendStatus).toBe("needs_va");
  });
});

describe("capturing the clinic's follow-up", () => {
  async function running() {
    const ctx = await scheduledTest();
    const engaged = ctx.byScript("engaged");
    const last = ctx.personas[ctx.personas.length - 1]!;
    ctx.clock.now = new Date(last.scheduledAt.getTime() + 60_000);
    await runShopperTick(ctx.deps);
    return { ...ctx, engaged: (await ctx.repo.getAssignment(engaged.id))! };
  }

  it("stores a personal reply once and queues a persona reply for a VA, which sends in-thread once", async () => {
    const { deps, repo, clock, sent, engaged } = await running();
    const reply = {
      to: `"${engaged.firstName}" <${engaged.email}>`,
      from: "Amy at Glow <amy@glowclinic.example>",
      subject: `Re: ${engaged.subject}`,
      text: `Hi ${engaged.firstName}! Consultations are free and take 30 minutes. Would Tuesday at 3 pm work? Also, can you send your date of birth?\n\nOn Mon, Oct 5 ${engaged.firstName} wrote:\n> ${engaged.message}`,
      headers: { "Auto-Submitted": "no" },
      messageId: "<abc123@glowclinic.example>",
      receivedAt: new Date(clock.now.getTime() + HOUR),
    };
    expect(await recordInboundEmail(deps, reply)).toMatchObject({ status: "stored" });
    expect(await recordInboundEmail(deps, reply)).toMatchObject({ status: "duplicate" });

    const [event] = (await repo.inboundForTest(engaged.testId)).filter((e) => e.assignmentId === engaged.id);
    expect(event).toMatchObject({ label: "personal", late: false, fromAddr: "amy@glowclinic.example" });
    expect(event!.body).not.toContain("wrote:");

    const task = (await repo.openTaskFor("approve_reply", { assignmentId: engaged.id }))!;
    const draft = task.payload.draft as string;
    expect(draft).toContain("I can fill that in when I come in."); // the date-of-birth deflection
    expect(draft.trim().endsWith(engaged.firstName)).toBe(true);
    expect(checkPersonaReply(draft)).toEqual([]);
    const delay = task.dueAt!.getTime() - reply.receivedAt.getTime();
    expect(delay).toBeGreaterThanOrEqual(60 * 60_000);
    expect(delay).toBeLessThanOrEqual(240 * 60_000);

    expect(await sendPersonaReply(deps, task.id, "Call me at 512-555-0199 to book!", "va@us.example")).toMatchObject({ ok: false, status: 400 });
    expect(await sendPersonaReply(deps, task.id, draft, "va@us.example")).toEqual({ ok: true });
    const out = sent[sent.length - 1]!;
    expect(out).toMatchObject({ to: "amy@glowclinic.example", subject: `Re: ${engaged.subject}`, replyTo: null });
    expect(out.headers).toMatchObject({ "In-Reply-To": "<abc123@glowclinic.example>", References: "<abc123@glowclinic.example>" });
    expect((await repo.getAssignment(engaged.id))!.repliesSent).toBe(1);
    expect(await sendPersonaReply(deps, task.id, draft, "va@us.example")).toMatchObject({ ok: false, status: 409 });

    // A second personal reply doesn't queue another persona reply: engaged personas reply once.
    await recordInboundEmail(deps, { ...reply, messageId: "<second@glowclinic.example>", text: "Just checking in, Jessica!" });
    expect(await repo.openTaskFor("approve_reply", { assignmentId: engaged.id })).toBeNull();
  });

  it("labels auto-replies, flags possible PHI, sets bounces aside, and routes strangers to a VA", async () => {
    const { deps, repo, clock, engaged, test } = await running();
    const at = new Date(clock.now.getTime() + 60_000);
    await recordInboundEmail(deps, { to: engaged.email, from: "noreply@glowclinic.example", subject: "Thank you for contacting us", text: "We've received your message and someone will be in touch.", headers: { "auto-submitted": "auto-replied" }, messageId: "<auto@x>", receivedAt: at });
    expect(await repo.openTaskFor("approve_reply", { assignmentId: engaged.id })).toBeNull();

    expect(await recordInboundEmail(deps, { to: engaged.email, from: "frontdesk@glowclinic.example", subject: "Records", text: "Attached are the lab results for Mary Smith, DOB 04/12/1968.", messageId: "<phi@x>", receivedAt: at, attachmentNames: ["smith-chart.pdf"] })).toMatchObject({ status: "flagged" });
    const phiTask = (await repo.openTasks()).find((t) => t.type === "review_phi")!;
    expect(phiTask.payload.signals).toEqual(expect.arrayContaining(["date_of_birth", "records_attachment"]));
    expect(JSON.stringify(phiTask.payload)).not.toContain("Mary Smith");

    expect(await recordInboundEmail(deps, { to: engaged.email, from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", subject: "Delivery Status Notification (Failure)", text: "Address not found", messageId: "<b@x>" })).toEqual({ status: "bounce" });
    expect((await repo.getTest(test.id))!.findings.map((f) => f.kind)).toEqual(["email_bounced"]);

    expect(await recordInboundEmail(deps, { to: "nobody@personas.example.net", from: "x@y.example", subject: "Hi", text: "Hello", messageId: "<u@x>" })).toMatchObject({ status: "unmatched" });

    const labels = (await repo.inboundForTest(test.id)).map((e) => [e.label, e.phiQuarantined]);
    expect(labels).toEqual([
      ["auto_reply", false],
      ["personal", true],
    ]);

    // Quarantined content is deleted after 7 days.
    clock.now = new Date(Date.now() + 8 * DAY);
    await runShopperTick(deps);
    const flagged = (await repo.inboundForTest(test.id)).find((e) => e.phiQuarantined)!;
    expect(flagged.body).toBeNull();
  });

  it("logs calls, voicemails, and texts on persona numbers, and marks late touches", async () => {
    const { deps, repo, clock, byScript } = await running();
    const silent = (await repo.getAssignment(byScript("silent").id))!;
    const engaged = (await repo.getAssignment(byScript("engaged").id))!;
    const at = new Date(clock.now.getTime() + 2 * HOUR);

    expect(await recordCallStart(deps, { sid: "CA1", from: "+15125550100", to: silent.phoneNumber!, receivedAt: at })).toEqual({ firstName: silent.firstName, sex: silent.sex });
    await recordCallDetails(deps, "CA1", { recordingUrl: "https://api.twilio.example/Recordings/RE1", recordingSeconds: 24 });
    await recordCallDetails(deps, "CA1", { durationSeconds: 41 });
    await recordTranscript(deps, "CA1", "Hi, this is Amy from Glow Clinic returning your call about Botox. Call us back at 512-555-0100.");
    expect(await recordTranscript(deps, "CA1", "again")).toMatchObject({ status: "duplicate" });
    const call = (await repo.inboundByExternalId("CA1"))!;
    expect(call).toMatchObject({ channel: "call", voicemail: true, durationSeconds: 41, label: "personal" });
    expect(call.body).toContain("returning your call");

    // A hang-up at the beep is a missed call, not a voicemail.
    await recordCallStart(deps, { sid: "CA2", from: "+15125550100", to: silent.phoneNumber!, receivedAt: at });
    await recordCallDetails(deps, "CA2", { recordingUrl: "https://api.twilio.example/Recordings/RE2", recordingSeconds: 1 });
    expect((await repo.inboundByExternalId("CA2"))!).toMatchObject({ voicemail: false, recordingUrl: null });

    // The engaged persona only got a text: it asks for email instead (to the clinic's public address).
    await recordSms(deps, { sid: "SM1", from: "+15125550100", to: engaged.phoneNumber!, body: "Hi! This is Glow Clinic. When can you come in?", receivedAt: at });
    const task = (await repo.openTaskFor("approve_reply", { assignmentId: engaged.id }))!;
    expect(task.payload).toMatchObject({ to: "hello@glowclinic.example", missedCall: true, inReplyTo: null });
    expect(task.payload.draft).toMatch(/^Sorry I keep missing your calls/);

    await recordSms(deps, { sid: "SM2", from: "+15125550100", to: silent.phoneNumber!, body: "Still interested?", receivedAt: new Date(silent.observeUntil!.getTime() + DAY) });
    expect((await repo.inboundByExternalId("SM2"))!.late).toBe(true);
    expect(await recordSms(deps, { sid: "SM3", from: "+1", to: "+19998887777", body: "?" })).toMatchObject({ status: "unmatched" });
  });
});

describe("closing and grading", () => {
  it("closes after the late window, grades with evidence, queues QA, and quarantines numbers", async () => {
    const { deps, repo, clock, test, personas } = await scheduledTest();
    const last = personas[personas.length - 1]!;
    clock.now = new Date(last.scheduledAt.getTime() + 60_000);
    await runShopperTick(deps);
    const sentAll = await repo.assignmentsForTest(test.id);
    const silent = sentAll.find((a) => a.script === "silent")!;
    await recordCallStart(deps, { sid: "CA9", from: "+15125550100", to: silent.phoneNumber!, receivedAt: new Date(silent.sentAt!.getTime() + 30 * 60_000) });
    await recordCallDetails(deps, "CA9", { recordingUrl: "https://api.twilio.example/Recordings/RE9", recordingSeconds: 20 });
    await recordTranscript(deps, "CA9", "Hi, this is Amy from Glow Clinic. We'd love to get you in for Botox. Call us at 512-555-0100 or book online.");

    const lateUntil = Math.max(...sentAll.map((a) => a.lateUntil!.getTime()));
    clock.now = new Date(lateUntil - 60_000);
    expect(await runShopperTick(deps)).toMatchObject({ closed: 0 });
    clock.now = new Date(lateUntil + 60_000);
    expect(await runShopperTick(deps)).toMatchObject({ closed: 1 });

    const graded = (await repo.getTest(test.id))!;
    expect(graded.status).toBe("qa");
    expect(graded.grade).toMatch(/^[A-F]$/);
    const report = reviveReport(graded.result)!;
    expect(report.inquiriesDelivered).toBe(3);
    expect(report.timeline.map((t) => t.label)).toEqual(["Persona A: Silent", "Persona B: Engaged", "Persona C: Price check"]);
    expect(report.timeline[0]!.touches[0]).toMatchObject({ channel: "call", voicemail: true, hasRecording: true });
    expect(report.cleanup).toHaveLength(3);
    expect(report.fixIt.scripts.length).toBeGreaterThan(3);
    expect(report.grade.personas[0]!.speedBand).toBeTruthy();
    expect(report.grade.method).toBe("heuristic");

    const qa = (await repo.openTasks()).find((t) => t.type === "qa_report")!;
    expect(qa.title).toContain(graded.grade!);
    expect((await repo.listNumbers()).every((n) => n.status === "quarantined")).toBe(true);
  });

  it("keeps AI judgements only when their quoted evidence is really in the message", async () => {
    const { keepValidJudgements } = await import("@/lib/shopper/ai");
    const texts = new Map([["t1", "Hi Jessica!  Botox is $12\nper unit. Want to book Tuesday?"]]);
    const criteria = new Set(["price_clarity", "asked_for_appointment", "tone"]);
    const kept = keepValidJudgements(
      [
        { touchId: "t1", criterionId: "price_clarity", met: true, quote: "Botox is $12 per unit" }, // whitespace differs: kept
        { touchId: "t1", criterionId: "asked_for_appointment", met: true, quote: "Would you like to book?" }, // not in the text
        { touchId: "t1", criterionId: "tone", met: false, quote: null },
        { touchId: "t1", criterionId: "made_up", met: true, quote: "Hi Jessica" },
        { touchId: "t9", criterionId: "tone", met: true, quote: "Hi" },
        { touchId: "t1", criterionId: "tone", met: true, quote: " " },
      ],
      texts,
      criteria,
    );
    expect(kept.map((j) => `${j.criterionId}:${j.met}`)).toEqual(["price_clarity:true", "tone:false"]);
  });

  it("asks the AI judge when it's configured", async () => {
    const aiJudge = vi.fn(async () => []);
    const { deps, repo, clock, test, personas } = await scheduledTest({ aiJudge });
    clock.now = new Date(personas[personas.length - 1]!.scheduledAt.getTime() + 60_000);
    await runShopperTick(deps);
    clock.now = new Date(clock.now.getTime() + 20 * DAY);
    await runShopperTick(deps);
    expect(aiJudge).toHaveBeenCalledOnce();
    expect((await repo.getTest(test.id))!.status).toBe("qa");
  });
});

describe("persona reply drafts", () => {
  const base = {
    clinicTypeName: "Med spa",
    serviceName: "Botox",
    personaFirstName: "Jessica",
    missedCall: false,
    question: "Is the consultation free?",
    objection: "Hmm, that's a bit more than I expected.",
    deflections: [],
    styleRules: [],
    neverRules: [],
  };
  it("asks one question, or objects only when a price was given", () => {
    expect(templateReply({ ...base, script: "engaged", clinicMessage: "Happy to help!" })).toBe("Thanks so much for getting back to me! Is the consultation free?\n\nJessica");
    expect(templateReply({ ...base, script: "price_check", clinicMessage: "It's $12 per unit." })).toContain("more than I expected");
    expect(templateReply({ ...base, script: "price_check", clinicMessage: "Come in for a consult!" })).toContain("rough idea of the price");
  });

  it("blocks drafts that break persona rules", () => {
    expect(checkPersonaReply("Thanks! I'm running a secret shopper test.")).not.toEqual([]);
    expect(checkPersonaReply("Great, book me for Tuesday!")).not.toEqual([]);
    expect(checkPersonaReply("My birthday is 4/12/1990")).not.toEqual([]);
    expect(checkPersonaReply("Thanks! Is there any downtime afterward?\n\nJessica")).toEqual([]);
  });
});

describe("retention", () => {
  it("drops voicemail audio after 12 months and evidence after 24, keeping scores", async () => {
    const { applyRetention } = await import("@/lib/shopper/retention");
    const { deps, repo, clock, test, personas } = await scheduledTest();
    clock.now = new Date(personas[personas.length - 1]!.scheduledAt.getTime() + 60_000);
    await runShopperTick(deps);
    const silent = (await repo.assignmentsForTest(test.id)).find((a) => a.script === "silent")!;
    await recordCallStart(deps, { sid: "CAold", from: "+15125550100", to: silent.phoneNumber!, receivedAt: clock.now });
    await recordCallDetails(deps, "CAold", { recordingUrl: "https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE1", recordingSeconds: 10 });
    await recordTranscript(deps, "CAold", "Hi, this is the clinic calling back.");
    clock.now = new Date(clock.now.getTime() + 20 * DAY);
    await runShopperTick(deps); // closes and grades

    clock.now = new Date(clock.now.getTime() + 400 * DAY);
    expect(await applyRetention(deps)).toEqual({ recordings: 1, evidence: 0 });
    expect((await repo.inboundByExternalId("CAold"))!).toMatchObject({ recordingUrl: null, body: "Hi, this is the clinic calling back." });

    clock.now = new Date(clock.now.getTime() + 400 * DAY);
    expect((await applyRetention(deps)).evidence).toBeGreaterThan(0);
    const after = (await repo.getTest(test.id))!;
    expect(after.result).toBeNull();
    expect(after.grade).toMatch(/^[A-F]$/);
    expect((await repo.inboundByExternalId("CAold"))!.body).toBeNull();
  });
});
