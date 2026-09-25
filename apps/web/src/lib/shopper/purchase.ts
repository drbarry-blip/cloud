import "server-only";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { emailMatchesWebsite, websiteHost, SCRIPTS, WEEKDAYS, type WeeklyHours } from "@cgs/core";
import { z } from "zod";
import { config } from "../config";
import { today } from "../http";
import { takeDaily } from "../rate-limit";
import { normalizeEmail } from "../store/types";
import { createToken } from "../tokens";
import { trySend, type ShopperDeps } from "./deps";
import { clinicCodeEmail, orderPaidEmail, verificationFailedEmail } from "./emails";
import { notifyOps } from "./ops";
import type { Clinic, Order } from "./repo";
import { orderStatusUrl, scheduleTest } from "./schedule";

const DAY = 24 * 60 * 60 * 1000;

export const PRICES = {
  baseline: { cents: 19_900, name: "Secret Shopper Baseline Test" },
  retest_monthly: { cents: 9_900, name: "Secret Shopper Monthly Retest" },
} as const;

export const formatUsd = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM times");
const DayHours = z
  .object({ open: HHMM, close: HHMM })
  .refine((d) => d.open < d.close, "Closing time must be after opening time")
  .nullable();
const WeeklyHoursSchema = z.object(Object.fromEntries(WEEKDAYS.map((d) => [d, DayHours])) as Record<(typeof WEEKDAYS)[number], typeof DayHours>);

const isTimezone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export const StartOrderSchema = z.object({
  email: z.email("Enter a valid email address.").max(254),
  marketingConsent: z.boolean().default(false),
  clinic: z.object({
    placeId: z.string().regex(/^[A-Za-z0-9_-]{10,300}$/).nullish(),
    name: z.string().trim().min(2, "Enter the clinic's name.").max(120),
    address: z.string().trim().max(300).nullish(),
    website: z.string().trim().max(300).nullish(),
    phone: z.string().trim().max(40).nullish(),
    publicEmail: z.email("Enter a valid public email address.").max(254).nullish(),
    formUrls: z.array(z.url().max(500)).max(5).default([]),
    clinicType: z.string().max(60),
    services: z.array(z.string().max(60)).min(1, "Pick at least one service.").max(3, "Pick up to three services."),
    timezone: z.string().max(60).refine(isTimezone, "Pick a time zone."),
    hours: WeeklyHoursSchema,
    blackoutDates: z.array(z.iso.date()).max(60).default([]),
    ownerStandard: z.string().trim().max(1000).nullish(),
    bookingLink: z.url().max(500).nullish(),
  }),
  authorizations: z.object({
    ownsClinic: z.literal(true, "Please confirm you own or manage this clinic."),
    authorizesInquiries: z.literal(true, "Please authorize the fictional inquiries."),
    willDeleteLeads: z.literal(true, "Please agree to delete the test leads afterward."),
  }),
});
export type StartOrderInput = z.infer<typeof StartOrderSchema>;

export type Result<T = object> = ({ ok: true } & T) | { ok: false; status: number; message: string };

const sameSite = (url: string, host: string) => {
  const h = websiteHost(url);
  return Boolean(h && (h === host || h.endsWith(`.${host}`)));
};

/**
 * Whether a buyer can be verified by their email domain alone. Every place we'll
 * contact (forms and the public email) must also be on the clinic's own domain,
 * so a verified domain can't be used to aim inquiries at someone else.
 */
export function canAutoVerify(buyerEmail: string, clinic: Pick<Clinic, "website" | "publicEmail" | "formUrls">): boolean {
  if (!emailMatchesWebsite(buyerEmail, clinic.website)) return false;
  if (clinic.publicEmail && !emailMatchesWebsite(clinic.publicEmail, clinic.website)) return false;
  return true;
}

/** Step 1: saves the clinic, creates an unpaid order and test, and returns where to pay. */
export async function startBaselineOrder(deps: ShopperDeps, input: StartOrderInput): Promise<Result<{ orderId: string; checkoutUrl: string }>> {
  const { repo, playbook } = deps;
  const c = input.clinic;
  const clinicType = playbook.clinicTypes[c.clinicType];
  if (!clinicType) return { ok: false, status: 400, message: "Pick a clinic type." };
  const known = new Set(clinicType.services.map((s) => s.id));
  if (!c.services.every((s) => known.has(s))) return { ok: false, status: 400, message: "Pick services from the list." };
  if (!Object.values(c.hours).some(Boolean)) return { ok: false, status: 400, message: "Enter the clinic's opening hours." };

  const host = websiteHost(c.website);
  if (c.website && !host) return { ok: false, status: 400, message: "Enter the clinic's website address, like https://yourclinic.com." };
  const formUrls = [...new Set(c.formUrls)];
  if (formUrls.length && !host) return { ok: false, status: 400, message: "Add the clinic's website so we can use its contact forms." };
  if (host && !formUrls.every((u) => sameSite(u, host))) {
    return { ok: false, status: 400, message: `Contact form pages must be on the clinic's website (${host}).` };
  }
  if (formUrls.length === 0 && !c.publicEmail) {
    return { ok: false, status: 400, message: "We need a contact form or a public email address to send the inquiries to." };
  }

  const location = { placeId: c.placeId ?? null, websiteHost: host };
  if (await repo.activeTestAtLocation(location)) {
    return { ok: false, status: 409, message: "A Secret Shopper test is already underway for this clinic. Only one can run at a time." };
  }

  const lead = await deps.store.upsertLead({ email: input.email, source: "secret_shopper", marketingConsent: input.marketingConsent });
  const price = PRICES.baseline;
  const { order } = await repo.transaction(async (tx) => {
    const details = {
      ownerLeadId: lead.id,
      placeId: location.placeId,
      name: c.name,
      address: c.address ?? null,
      website: c.website ?? null,
      websiteHost: host,
      phone: c.phone ?? null,
      publicEmail: c.publicEmail ? normalizeEmail(c.publicEmail) : null,
      formUrls,
      clinicType: c.clinicType,
      services: c.services,
      timezone: c.timezone,
      hours: c.hours as WeeklyHours,
      blackoutDates: [...new Set(c.blackoutDates)].sort(),
      ownerStandard: c.ownerStandard || null,
      bookingLink: c.bookingLink || null,
    };
    // A repeat buyer keeps their clinic record, and with it their verification.
    const existing = await tx.findOwnClinic(lead.id, location);
    const clinic = existing ? (await tx.updateClinicDetails(existing.id, details))! : await tx.createClinic(details);
    // Verification covers where inquiries go. If the website or email changed, verify again.
    if (existing?.verificationStatus === "verified" && (existing.websiteHost !== details.websiteHost || existing.publicEmail !== details.publicEmail)) {
      await tx.setVerification(existing.id, "pending", null, deps.now());
    }
    const order = await tx.createOrder({ clinicId: clinic.id, leadId: lead.id, product: "baseline", amountCents: price.cents });
    await tx.createTest({
      clinicId: clinic.id,
      orderId: order.id,
      kind: "baseline",
      status: "awaiting_payment",
      scripts: playbook.personaRules.test_mix.baseline.filter((s) => (SCRIPTS as readonly string[]).includes(s)),
      seed: randomInt(1, 2 ** 31 - 1),
      playbookVersion: playbook.version,
    });
    await tx.audit(`email:${lead.email}`, "order.created", { type: "order", id: order.id }, { clinic: clinic.name, authorizations: input.authorizations });
    return { order };
  });

  const statusUrl = orderStatusUrl(deps.siteUrl, order.id);
  if (deps.stripe) {
    const session = await deps.stripe.createCheckoutSession({
      mode: "payment",
      productName: `${price.name}: ${c.name}`,
      amountCents: price.cents,
      customerEmail: lead.email,
      clientReferenceId: order.id,
      metadata: { orderId: order.id, product: "baseline" },
      successUrl: `${statusUrl}&paid=1`,
      cancelUrl: `${deps.siteUrl}/secret-shopper/start?cancelled=1`,
      idempotencyKey: `checkout-${order.id}`,
    });
    await repo.setOrderStripeSession(order.id, session.id);
    return { ok: true, orderId: order.id, checkoutUrl: session.url };
  }
  if (deps.allowSimulatedCheckout) {
    return { ok: true, orderId: order.id, checkoutUrl: `${deps.siteUrl}/secret-shopper/dev-checkout?t=${encodeURIComponent(createToken("order", order.id))}` };
  }
  return { ok: false, status: 503, message: "Checkout isn't available right now. Please try again later." };
}

/**
 * Step 2 (Stripe webhook or the development checkout): records payment and starts
 * ownership verification. Safe to call more than once for the same order.
 */
export async function handleOrderPaid(
  deps: ShopperDeps,
  orderId: string,
  payment: { paymentIntent?: string | null; customerId?: string | null } = {},
): Promise<"processed" | "duplicate" | "missing"> {
  const { repo } = deps;
  const now = deps.now();
  const order = await repo.markOrderPaid(orderId, { paidAt: now, paymentIntent: payment.paymentIntent, customerId: payment.customerId });
  if (!order) return (await repo.getOrder(orderId)) ? "duplicate" : "missing";
  await repo.audit("stripe", "order.paid", { type: "order", id: order.id }, { amountCents: order.amountCents });

  const clinic = (await repo.getClinic(order.clinicId))!;
  const lead = (await deps.store.getLead(order.leadId))!;
  const test = await repo.testForOrder(order.id);
  // Two unpaid orders for one location can both reach checkout; only the first to pay starts.
  const other = await repo.activeTestAtLocation({ placeId: clinic.placeId, websiteHost: clinic.websiteHost });
  const moved =
    test && (!other || other.id === test.id) && (await repo.transitionTest(test.id, ["awaiting_payment"], "awaiting_verification", "Paid; verifying ownership"));
  if (!moved) {
    const task = await repo.createTask({
      type: "fix_failure",
      title: `Paid order can't start: ${clinic.name}`,
      testId: test?.id ?? null,
      clinicId: clinic.id,
      payload: { orderId: order.id, reason: "Another test is active for this clinic, or the test was cancelled. Refund or reschedule." },
      dueAt: new Date(now.getTime() + DAY),
    });
    await notifyOps(deps, task, [`Clinic: ${clinic.name}`, "A paid order couldn't start. Refund or reschedule it."]);
    return "processed";
  }

  if (clinic.verificationStatus === "verified") {
    await scheduleTest(deps, moved.id);
    return "processed";
  }

  const statusUrl = orderStatusUrl(deps.siteUrl, order.id);
  const auto = canAutoVerify(lead.email, clinic);
  if (auto && lead.confirmedAt) {
    await verifyClinic(deps, clinic.id, "email_domain", "system");
  } else if (auto) {
    const confirmUrl = `${deps.siteUrl}/secret-shopper/confirm?t=${encodeURIComponent(createToken("buyer_confirm", order.id))}`;
    await trySend(deps, { ...orderPaidEmail({ clinicName: clinic.name, amount: formatUsd(order.amountCents), statusUrl, confirmUrl }), to: lead.email }, "order paid");
  } else {
    await openVerificationTask(deps, clinic, order, lead.email);
    await trySend(deps, { ...orderPaidEmail({ clinicName: clinic.name, amount: formatUsd(order.amountCents), statusUrl, confirmUrl: null }), to: lead.email }, "order paid");
  }
  return "processed";
}

async function openVerificationTask(deps: ShopperDeps, clinic: Clinic, order: Order, buyerEmail: string) {
  const { repo } = deps;
  if (await repo.openTaskFor("verify_ownership", { clinicId: clinic.id })) return;
  const others = await repo.otherOwnersOfLocation({ placeId: clinic.placeId, websiteHost: clinic.websiteHost }, clinic.ownerLeadId);
  const flags = [
    ...(others.length ? [`${others.length} other account(s) have set up this location`] : []),
    ...(clinic.publicEmail && !emailMatchesWebsite(clinic.publicEmail, clinic.website) ? ["The public email isn't on the clinic's website domain; check it's really the clinic's"] : []),
    ...(!emailMatchesWebsite(buyerEmail, clinic.website) ? ["The buyer's email isn't on the clinic's website domain"] : []),
  ];
  const task = await repo.createTask({
    type: "verify_ownership",
    title: `Verify ownership: ${clinic.name}`,
    clinicId: clinic.id,
    testId: (await repo.testForOrder(order.id))?.id ?? null,
    payload: {
      orderId: order.id,
      buyerEmail,
      clinic: { name: clinic.name, address: clinic.address, website: clinic.website, phone: clinic.phone, publicEmail: clinic.publicEmail, formUrls: clinic.formUrls, placeId: clinic.placeId },
      flags,
    },
    dueAt: new Date(deps.now().getTime() + DAY),
  });
  await notifyOps(deps, task, [`Clinic: ${clinic.name}`, `Buyer: ${buyerEmail}`, ...flags]);
}

/** The buyer clicked the link in the order email. Verifies by email domain when it matches. */
export async function confirmBuyer(deps: ShopperDeps, orderId: string): Promise<Result> {
  const { repo } = deps;
  const order = await repo.getOrder(orderId);
  if (!order) return { ok: false, status: 404, message: "We couldn't find that order." };
  const lead = await deps.store.confirmLead(order.leadId, deps.now());
  const clinic = (await repo.getClinic(order.clinicId))!;
  if (clinic.verificationStatus === "pending" && lead && canAutoVerify(lead.email, clinic)) {
    await verifyClinic(deps, clinic.id, "email_domain", `email:${lead.email}`);
  }
  return { ok: true };
}

function codeDigest(clinicId: string, code: string, expiresAt: number) {
  return createHmac("sha256", config.appSecret()).update(`clinic-code:${clinicId}:${code}:${expiresAt}`).digest("hex");
}

/** Emails a six-digit code to the clinic's public address. The owner enters it on the order page. */
export async function sendClinicCode(deps: ShopperDeps, orderId: string): Promise<Result> {
  const { repo } = deps;
  const order = await repo.getOrder(orderId);
  if (!order) return { ok: false, status: 404, message: "We couldn't find that order." };
  const clinic = (await repo.getClinic(order.clinicId))!;
  if (clinic.verificationStatus !== "pending") return { ok: false, status: 409, message: "This clinic doesn't need verifying." };
  if (!clinic.publicEmail) return { ok: false, status: 400, message: "There's no public email on file for this clinic. Our team will verify another way." };
  if (!(await takeDaily(deps.store, "clinic-code:send", clinic.id, 3, deps.now()))) {
    return { ok: false, status: 429, message: "We've sent several codes today. Please check the clinic's inbox, or try again tomorrow." };
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = deps.now().getTime() + 2 * DAY;
  await repo.setVerificationCodeHash(clinic.id, `${expiresAt}:${codeDigest(clinic.id, code, expiresAt)}`);
  const sent = await trySend(deps, { ...clinicCodeEmail({ clinicName: clinic.name, code }), to: clinic.publicEmail }, "clinic code");
  if (!sent) return { ok: false, status: 502, message: "We couldn't send the code just now. Please try again in a few minutes." };
  await repo.audit("system", "clinic.code_sent", { type: "clinic", id: clinic.id }, { day: today(deps.now()) });
  return { ok: true };
}

export async function checkClinicCode(deps: ShopperDeps, orderId: string, code: string): Promise<Result> {
  const { repo } = deps;
  const order = await repo.getOrder(orderId);
  if (!order) return { ok: false, status: 404, message: "We couldn't find that order." };
  const clinic = (await repo.getClinic(order.clinicId))!;
  if (clinic.verificationStatus === "verified") return { ok: true };
  if (clinic.verificationStatus !== "pending") return { ok: false, status: 409, message: "This clinic can't be verified with a code." };
  if (!(await takeDaily(deps.store, "clinic-code:check", clinic.id, 10, deps.now()))) {
    return { ok: false, status: 429, message: "Too many tries today. Please try again tomorrow." };
  }
  const stored = await repo.verificationCodeHash(clinic.id);
  const [expires, digest] = stored?.split(":") ?? [];
  const wrong = { ok: false as const, status: 400, message: "That code doesn't match. Check the latest email and try again." };
  if (!expires || !digest || !/^\d{6}$/.test(code.trim())) return wrong;
  if (Number(expires) < deps.now().getTime()) return { ok: false, status: 400, message: "That code has expired. Send a new one." };
  const expected = Buffer.from(codeDigest(clinic.id, code.trim(), Number(expires)));
  const given = Buffer.from(digest);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return wrong;
  await verifyClinic(deps, clinic.id, "clinic_code", "system");
  return { ok: true };
}

/** Marks a clinic verified (by any method) and schedules its waiting tests. */
export async function verifyClinic(deps: ShopperDeps, clinicId: string, method: "email_domain" | "clinic_code" | "manual", actor: string) {
  const { repo } = deps;
  const now = deps.now();
  await repo.setVerification(clinicId, "verified", method, now);
  await repo.cancelOpenTasks({ clinicId, type: "verify_ownership" }, now, `Verified (${method})`);
  await repo.audit(actor, "clinic.verified", { type: "clinic", id: clinicId }, { method });
  for (const test of await repo.testsForClinic(clinicId)) {
    if (test.status === "awaiting_verification") await scheduleTest(deps, test.id);
  }
}

/** Verification failed: cancel waiting tests and refund them in full (SPEC.md §7.1). */
export async function rejectVerification(deps: ShopperDeps, clinicId: string, actor: string, reason: string) {
  const { repo } = deps;
  const now = deps.now();
  const clinic = await repo.setVerification(clinicId, "rejected", null, now);
  if (!clinic) return;
  await repo.cancelOpenTasks({ clinicId, type: "verify_ownership" }, now, "Rejected");
  await repo.audit(actor, "clinic.rejected", { type: "clinic", id: clinicId }, { reason });
  for (const test of await repo.testsForClinic(clinicId)) {
    if (!(await repo.transitionTest(test.id, ["awaiting_payment", "awaiting_verification"], "cancelled", "Ownership couldn't be verified"))) continue;
    const order = test.orderId ? await repo.getOrder(test.orderId) : null;
    if (!order) continue;
    const refunded = await refundOrder(deps, order, actor);
    const lead = await deps.store.getLead(order.leadId);
    if (lead) await trySend(deps, { ...verificationFailedEmail({ clinicName: clinic.name, refunded }), to: lead.email }, "verification failed");
  }
}

/** Refunds a paid order in full. Returns true if money went back (or would have, in development). */
export async function refundOrder(deps: ShopperDeps, order: Order, actor: string): Promise<boolean> {
  const { repo } = deps;
  if (order.status === "pending") {
    await repo.setOrderStatus(order.id, "cancelled");
    return false;
  }
  if (order.status !== "paid") return order.status === "refunded";
  if (deps.stripe && order.stripePaymentIntent) await deps.stripe.refund(order.stripePaymentIntent);
  else if (deps.stripe) throw new Error(`Order ${order.id} has no payment to refund`);
  await repo.setOrderStatus(order.id, "refunded");
  await repo.audit(actor, "order.refunded", { type: "order", id: order.id }, { amountCents: order.amountCents });
  return true;
}
