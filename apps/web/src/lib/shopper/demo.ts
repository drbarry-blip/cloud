import "server-only";
import { DEFAULT_HOURS } from "@cgs/core";
import type { ShopperDeps } from "./deps";
import { runShopperTick } from "./engine";
import { recordCallDetails, recordCallStart, recordInboundEmail, recordSms, recordTranscript } from "./inbound";
import { sendPersonaReply } from "./persona-reply";
import { confirmBuyer, handleOrderPaid, startBaselineOrder, StartOrderSchema } from "./purchase";
import type { Assignment } from "./repo";

// Runs a complete fictional test through the real code paths, with the clock moved
// into the past: order, verification, scheduling, sending, the clinic's calls,
// voicemails, emails, and texts, persona replies, and grading. For development, the
// console walkthrough, and the sample report. Never sends real email.

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export async function seedDemoTest(base: ShopperDeps, opts: { suffix?: string; staffEmail?: string } = {}): Promise<{ testId: string; orderId: string }> {
  const realNow = base.now();
  // Far enough back that the whole test, late window included, is over by today.
  let now = new Date(realNow.getTime() - 40 * DAY);
  const deps: ShopperDeps = {
    ...base,
    now: () => now,
    sendEmail: async () => ({ id: null }),
    formBot: { submit: async () => ({ status: "submitted", confirmation: "Thank you! Someone from our team will reach out shortly." }) },
    aiDraft: null,
    aiJudge: base.aiJudge ?? null,
  };
  const { repo } = deps;
  // Fictional 555 numbers so the demo's calls and texts land on personas.
  const pool = await repo.listNumbers();
  if (!pool.some((n) => n.status === "available")) for (const n of ["+15125550190", "+15125550191", "+15125550192"]) await repo.addNumber(n);
  const suffix = opts.suffix ?? String(realNow.getTime() % 100000);
  const host = `glow-sample-${suffix}.example`;
  const input = StartOrderSchema.parse({
    email: `owner@${host}`,
    clinic: {
      name: "Glow Sample Med Spa",
      address: "100 Congress Ave, Austin, TX 78701, USA",
      website: `https://www.${host}/`,
      phone: "(512) 555-0142",
      publicEmail: `hello@${host}`,
      formUrls: [`https://www.${host}/contact`],
      clinicType: "med_spa",
      services: ["neurotoxin", "filler", "laser_hair_removal"],
      timezone: "America/Chicago",
      hours: DEFAULT_HOURS,
      ownerStandard: "Call every new lead within 15 minutes during business hours and follow up for a week.",
    },
    authorizations: { ownsClinic: true, authorizesInquiries: true, willDeleteLeads: true },
  });
  const order = await startBaselineOrder(deps, input);
  if (!order.ok) throw new Error(order.message);
  await handleOrderPaid(deps, order.orderId, { paymentIntent: `pi_demo_${suffix}` });
  await confirmBuyer(deps, order.orderId);
  const test = (await repo.testForOrder(order.orderId))!;
  const personas = await repo.assignmentsForTest(test.id);
  const by = (s: Assignment["script"]) => personas.find((p) => p.script === s)!;

  // Send each inquiry at its scheduled time.
  for (const p of personas) {
    now = new Date(p.scheduledAt.getTime() + MIN);
    await runShopperTick(deps);
  }
  const sent = async (s: Assignment["script"]) => (await repo.getAssignment(by(s).id))!;
  const silent = await sent("silent");
  const engaged = await sent("engaged");
  const price = await sent("price_check");
  const at = (a: Assignment, ms: number) => new Date(a.sentAt!.getTime() + ms);
  const clinicFrom = `Amy at Glow Sample <amy@${host}>`;
  const reply = async (a: Assignment, delay: number, text: string, extra: { subject?: string; auto?: boolean } = {}) => {
    await recordInboundEmail(deps, {
      to: a.email,
      from: extra.auto ? `Glow Sample Med Spa <noreply@${host}>` : clinicFrom,
      subject: extra.subject ?? `Re: ${a.subject}`,
      text,
      headers: extra.auto ? { "auto-submitted": "auto-replied" } : {},
      messageId: `<${a.id.slice(0, 8)}-${delay}@${host}>`,
      receivedAt: at(a, delay),
    });
  };
  const approveReply = async (a: Assignment, when: Date) => {
    now = when;
    const task = await repo.openTaskFor("approve_reply", { assignmentId: a.id });
    if (task) await sendPersonaReply(deps, task.id, String(task.payload.draft), `va:${opts.staffEmail ?? "demo@console"}`);
  };

  // Persona A (silent): a callback hours later, a voicemail without a number, one email, then nothing.
  now = at(silent, 5 * HOUR);
  await recordCallStart(deps, { sid: `CAdemo${suffix}1`, from: "+15125550142", to: silent.phoneNumber ?? "+15125550000", receivedAt: at(silent, 4.5 * HOUR) });
  await recordCallDetails(deps, `CAdemo${suffix}1`, { durationSeconds: 38, recordingUrl: "https://api.twilio.com/2010-04-01/Accounts/ACdemo/Recordings/REdemo", recordingSeconds: 22 });
  await recordTranscript(deps, `CAdemo${suffix}1`, `Hi ${silent.firstName}, this is Amy from Glow Sample Med Spa returning your message about Botox. Give us a call back when you get a chance. Thanks!`);
  await reply(silent, 1 * DAY + 2 * HOUR, `Hi ${silent.firstName}, following up on your Botox question. You can book a consultation here: https://www.${host}/book. Thanks! Amy`);

  // Persona B (engaged): an instant auto-reply, a personal answer the next morning, then one more reply after the persona's question.
  await reply(engaged, 1 * MIN, `Thanks for contacting Glow Sample Med Spa! We've received your message and someone will be in touch during business hours. Book anytime: https://www.${host}/book`, { subject: "Thank you for contacting us", auto: true });
  now = at(engaged, 15 * HOUR);
  await reply(engaged, 14 * HOUR, `Hi ${engaged.firstName}! Thanks for reaching out. Yes, we start with a free consultation so our injector can talk through what you're hoping for and what a first appointment looks like. Would you like me to book you a consult this week? We have Thursday at 11 am or Friday at 3 pm.\n\nAmy\nGlow Sample Med Spa\n(512) 555-0142`);
  await approveReply(engaged, at(engaged, 16 * HOUR));
  await reply(engaged, 2 * DAY, `Great question! Appointments usually take about 30 to 45 minutes. Let me know if Thursday or Friday works and I'll get you on the schedule.\n\nAmy`);

  // Persona C (price check): a price range the next day, the objection, a membership offer, then a text.
  now = at(price, 1 * DAY + 3 * HOUR);
  await reply(price, 1 * DAY + 2 * HOUR, `Hi ${price.firstName}, great question. Botox is $13 per unit, and most first-time clients need 20 to 40 units depending on the areas. Happy to help you figure out what you'd need at a free consult!\n\nAmy`);
  await approveReply(price, at(price, 1 * DAY + 5 * HOUR));
  await reply(price, 2 * DAY + 1 * HOUR, `Totally understand! We do have a membership that brings Botox down to $11 a unit, and we can also start with just one area. Want me to set up a quick consult so you can get an exact quote?\n\nAmy`);
  now = at(price, 4 * DAY);
  await recordSms(deps, { sid: `SMdemo${suffix}1`, from: "+15125550142", to: price.phoneNumber ?? "+15125550001", body: `Hi ${price.firstName}, it's Amy from Glow Sample Med Spa. Just checking in on your Botox question. Reply or call us at 512-555-0142 anytime!`, receivedAt: at(price, 4 * DAY) });

  // Close and grade at the real time.
  now = realNow;
  await runShopperTick(deps);
  return { testId: test.id, orderId: order.orderId };
}
