import { DEFAULT_HOURS, SCRIPTS } from "@cgs/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getPlaybook } from "@/lib/playbook";
import type { ShopperDeps } from "@/lib/shopper/deps";
import {
  canAutoVerify,
  checkClinicCode,
  confirmBuyer,
  handleOrderPaid,
  rejectVerification,
  sendClinicCode,
  startBaselineOrder,
  StartOrderSchema,
  type StartOrderInput,
} from "@/lib/shopper/purchase";
import { chooseRoutes, scheduleTest } from "@/lib/shopper/schedule";
import { handleStripeEvent } from "@/lib/shopper/stripe-events";
import type { StripeClient } from "@/lib/stripe";
import { verifyToken } from "@/lib/tokens";
import { HOUR, linkIn, makeDeps, NOW, orderInput, placeOrder, tokenFrom } from "./shopper-helpers";

afterEach(() => vi.restoreAllMocks());

describe("starting an order", () => {
  it("returns a simulated checkout in development, with an unpaid order and test", async () => {
    const { deps, repo } = await makeDeps();
    const res = await placeOrder(deps);
    expect(res.checkoutUrl).toMatch(/^https:\/\/app\.example\/secret-shopper\/dev-checkout\?t=/);
    expect(verifyToken(tokenFrom(res.checkoutUrl), "order")).toBe(res.orderId);
    const test = (await repo.testForOrder(res.orderId))!;
    expect(test).toMatchObject({ status: "awaiting_payment", kind: "baseline", scripts: [...SCRIPTS] });
    const clinic = (await repo.getClinic(test.clinicId))!;
    expect(clinic).toMatchObject({ websiteHost: "glowclinic.example", verificationStatus: "pending" });
  });

  it("uses Stripe Checkout when configured", async () => {
    const createCheckoutSession = vi.fn(async () => ({ id: "cs_test_1", url: "https://checkout.stripe.example/cs_test_1" }));
    const { deps, repo } = await makeDeps({ stripe: { createCheckoutSession } as unknown as StripeClient });
    const res = await placeOrder(deps);
    expect(res.checkoutUrl).toBe("https://checkout.stripe.example/cs_test_1");
    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "payment", amountCents: 19900, clientReferenceId: res.orderId, idempotencyKey: `checkout-${res.orderId}` }),
    );
    expect((await repo.getOrder(res.orderId))!.stripeSessionId).toBe("cs_test_1");
  });

  it("refuses orders it can't run or that would aim inquiries elsewhere", async () => {
    const { deps } = await makeDeps({ allowSimulatedCheckout: false });
    const fail = async (input: StartOrderInput) => {
      const res = await startBaselineOrder(deps, input);
      return res.ok ? null : res;
    };
    expect(await fail(orderInput({ clinic: { formUrls: ["https://rival.example/contact"] } }))).toMatchObject({ status: 400, message: expect.stringMatching(/on the clinic's website/) });
    expect(await fail(orderInput({ clinic: { formUrls: [], publicEmail: null } }))).toMatchObject({ status: 400, message: expect.stringMatching(/contact form or a public email/) });
    expect(await fail(orderInput({ clinic: { services: ["teeth_whitening"] } }))).toMatchObject({ status: 400 });
    expect(await fail(orderInput())).toMatchObject({ status: 503 }); // no Stripe in production
    expect(StartOrderSchema.safeParse({ ...orderInput(), authorizations: { ownsClinic: true, authorizesInquiries: false, willDeleteLeads: true } }).success).toBe(false);
  });
});

describe("paying and verifying by email domain", () => {
  it("confirms the buyer, verifies the clinic, and schedules three inquiries without revealing times", async () => {
    const { deps, repo, sent } = await makeDeps();
    await repo.addNumber("+13125550111");
    await repo.addNumber("+15125550199");
    const { orderId } = await placeOrder(deps);

    expect(await handleOrderPaid(deps, orderId, { paymentIntent: "pi_1", customerId: "cus_1" })).toBe("processed");
    expect(await handleOrderPaid(deps, orderId, { paymentIntent: "pi_1" })).toBe("duplicate");
    expect(await handleOrderPaid(deps, "00000000-0000-4000-8000-000000000000")).toBe("missing");
    expect((await repo.getOrder(orderId))!).toMatchObject({ status: "paid", stripePaymentIntent: "pi_1", stripeCustomerId: "cus_1" });

    const paidEmail = sent.find((m) => m.subject.startsWith("Order confirmed"))!;
    expect(paidEmail.to).toBe("owner@glowclinic.example");
    const confirmUrl = linkIn(paidEmail, "/secret-shopper/confirm");
    expect(verifyToken(tokenFrom(confirmUrl), "buyer_confirm")).toBe(orderId);
    expect(await repo.openTasks()).toEqual([]); // no VA needed

    expect(await confirmBuyer(deps, orderId)).toEqual({ ok: true });
    const test = (await repo.testForOrder(orderId))!;
    expect(test.status).toBe("scheduled");
    const clinic = (await repo.getClinic(test.clinicId))!;
    expect(clinic).toMatchObject({ verificationStatus: "verified", verificationMethod: "email_domain" });

    const personas = await repo.assignmentsForTest(test.id);
    expect(personas.map((p) => [p.script, p.channel, p.target])).toEqual([
      ["silent", "web_form", "https://www.glowclinic.example/contact"],
      ["engaged", "email", "hello@glowclinic.example"],
      ["price_check", "email", "hello@glowclinic.example"],
    ]);
    expect(new Set(personas.map((p) => p.serviceId)).size).toBe(3);
    expect(personas.every((p) => p.email.endsWith("@personas.example.net"))).toBe(true);
    // The local number goes to the first persona; the pool has one other number, then none.
    expect(personas.map((p) => p.phoneNumber)).toEqual(["+15125550199", "+13125550111", null]);

    const times = personas.map((p) => p.scheduledAt.getTime());
    expect(times[0]!).toBeGreaterThanOrEqual(NOW.getTime() + 24 * HOUR);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(24 * HOUR);
    expect(times[2]! - times[1]!).toBeGreaterThanOrEqual(24 * HOUR);
    expect(test.windowStart).toEqual(personas[0]!.scheduledAt);
    expect(test.windowEnd!.getTime()).toBe(times[2]! + 14 * 24 * HOUR);

    const scheduled = sent.find((m) => m.subject.startsWith("Your Secret Shopper test runs"))!;
    expect(scheduled.subject).toMatch(/runs (Oct|Nov) \d+/);
    expect(scheduled.text).not.toMatch(/\d{1,2}:\d{2}|\b[ap]\.?m\.?\b/i);
    expect(scheduled.text).not.toContain(personas[0]!.firstName);
  });

  it("verifies immediately when the buyer's email was already confirmed", async () => {
    const { deps, repo } = await makeDeps();
    const lead = await deps.store.upsertLead({ email: "owner@glowclinic.example", source: "visibility_score", marketingConsent: true });
    await deps.store.confirmLead(lead.id, NOW);
    const { orderId } = await placeOrder(deps);
    await handleOrderPaid(deps, orderId);
    expect((await repo.testForOrder(orderId))!.status).toBe("scheduled");
  });
});

describe("stripe events", () => {
  it("records payment only once the session is paid, and ignores other checkouts", async () => {
    const { deps, repo } = await makeDeps();
    const { orderId } = await placeOrder(deps);
    const session = (over: Record<string, unknown>) => ({
      id: "evt_1",
      type: "checkout.session.completed",
      data: { object: { mode: "payment", payment_status: "paid", client_reference_id: orderId, metadata: { orderId }, payment_intent: "pi_7", customer: "cus_7", ...over } },
    });
    expect(await handleStripeEvent(deps, session({ payment_status: "unpaid" }))).toBe("waiting for payment");
    expect(await handleStripeEvent(deps, session({ mode: "subscription" }))).toMatch(/^ignored/);
    expect(await handleStripeEvent(deps, { id: "evt_2", type: "customer.created", data: { object: {} } })).toBe("ignored");
    expect((await repo.getOrder(orderId))!.status).toBe("pending");
    expect(await handleStripeEvent(deps, session({}))).toBe("processed");
    expect(await handleStripeEvent(deps, session({}))).toBe("duplicate");
    expect((await repo.getOrder(orderId))!).toMatchObject({ status: "paid", stripePaymentIntent: "pi_7", stripeCustomerId: "cus_7" });
  });
});

describe("verifying by a code sent to the clinic", () => {
  it("opens a VA task, then verifies with the right code", async () => {
    const { deps, repo, sent } = await makeDeps();
    const { orderId } = await placeOrder(deps, orderInput({ email: "glowowner@gmail.com" }));
    await handleOrderPaid(deps, orderId);

    const [task] = await repo.openTasks();
    expect(task).toMatchObject({ type: "verify_ownership", title: "Verify ownership: Glow Clinic" });
    expect(task!.payload).toMatchObject({ buyerEmail: "glowowner@gmail.com", flags: ["The buyer's email isn't on the clinic's website domain"] });
    expect(sent.some((m) => m.to === "ops@us.example" && m.subject === "[Ops] Verify ownership: Glow Clinic")).toBe(true);
    expect(linkIn(sent.find((m) => m.subject.startsWith("Order confirmed"))!, "/secret-shopper/order")).toBeTruthy();

    expect(await sendClinicCode(deps, orderId)).toEqual({ ok: true });
    const codeEmail = sent.find((m) => m.to === "hello@glowclinic.example")!;
    expect(codeEmail.text).not.toMatch(/secret shopper|test|inquir/i);
    const code = /code is: (\d{6})/.exec(codeEmail.text)![1]!;

    const wrong = code === "000000" ? "111111" : "000000";
    expect(await checkClinicCode(deps, orderId, wrong)).toMatchObject({ ok: false, status: 400 });
    expect(await checkClinicCode(deps, orderId, code)).toEqual({ ok: true });
    expect((await repo.testForOrder(orderId))!.status).toBe("scheduled");
    expect(await repo.openTasks()).toEqual([]);
    expect((await repo.getTask(task!.id))!.status).toBe("cancelled");
  });

  it("expires codes and limits how many are sent", async () => {
    let now = NOW;
    const { deps } = await makeDeps({ now: () => now });
    const { orderId } = await placeOrder(deps, orderInput({ email: "glowowner@gmail.com" }));
    await handleOrderPaid(deps, orderId);
    for (let i = 0; i < 3; i++) expect((await sendClinicCode(deps, orderId)).ok).toBe(true);
    expect(await sendClinicCode(deps, orderId)).toMatchObject({ ok: false, status: 429 });
    now = new Date(NOW.getTime() + 49 * HOUR);
    expect(await checkClinicCode(deps, orderId, "123456")).toMatchObject({ ok: false, message: expect.stringMatching(/expired/) });
  });
});

describe("guarding against misuse", () => {
  it("never auto-verifies when the public email is off the clinic's domain", () => {
    const clinic = { website: "https://glowclinic.example", publicEmail: "rival@othermail.example", formUrls: [] };
    expect(canAutoVerify("owner@glowclinic.example", clinic)).toBe(false);
    expect(canAutoVerify("owner@glowclinic.example", { ...clinic, publicEmail: "hello@glowclinic.example" })).toBe(true);
  });

  it("refunds in full when verification fails", async () => {
    const refund = vi.fn(async () => ({ id: "re_1", status: "succeeded" }));
    const createCheckoutSession = vi.fn(async () => ({ id: "cs_1", url: "https://checkout.stripe.example/cs_1" }));
    const { deps, repo, sent } = await makeDeps({ stripe: { refund, createCheckoutSession } as unknown as StripeClient });
    const { orderId } = await placeOrder(deps, orderInput({ email: "someone@gmail.com" }));
    await handleOrderPaid(deps, orderId, { paymentIntent: "pi_9" });
    const test = (await repo.testForOrder(orderId))!;
    await rejectVerification(deps, test.clinicId, "email:admin@us.example", "Couldn't reach the owner");
    expect(refund).toHaveBeenCalledWith("pi_9");
    expect((await repo.getOrder(orderId))!.status).toBe("refunded");
    expect((await repo.getTest(test.id))!.status).toBe("cancelled");
    expect(sent.some((m) => m.to === "someone@gmail.com" && /couldn't verify/i.test(m.subject))).toBe(true);
  });

  it("allows one active test per location, even across accounts", async () => {
    const { deps, repo } = await makeDeps();
    const first = await placeOrder(deps, orderInput({ email: "a@gmail.com" }));
    const second = await placeOrder(deps, orderInput({ email: "b@gmail.com" })); // both unpaid, so both allowed
    await handleOrderPaid(deps, first.orderId);
    expect(await startBaselineOrder(deps, orderInput({ email: "c@gmail.com" }))).toMatchObject({ ok: false, status: 409 });
    await handleOrderPaid(deps, second.orderId);
    expect((await repo.testForOrder(second.orderId))!.status).toBe("awaiting_payment");
    expect((await repo.openTasks()).map((t) => t.type).sort()).toEqual(["fix_failure", "verify_ownership"]);
  });

  it("keeps a repeat buyer verified, unless where inquiries go has changed", async () => {
    const { deps, repo } = await makeDeps();
    const first = await placeOrder(deps);
    await handleOrderPaid(deps, first.orderId);
    await confirmBuyer(deps, first.orderId);
    const clinicId = (await repo.testForOrder(first.orderId))!.clinicId;
    const test = (await repo.testForOrder(first.orderId))!;
    await repo.transitionTest(test.id, ["scheduled"], "delivered");

    const again = await placeOrder(deps);
    expect((await repo.testForOrder(again.orderId))!.clinicId).toBe(clinicId);
    expect((await repo.getClinic(clinicId))!.verificationStatus).toBe("verified");

    const changed = await placeOrder(deps, orderInput({ clinic: { publicEmail: "frontdesk@elsewhere.example" } }));
    expect((await repo.testForOrder(changed.orderId))!.clinicId).toBe(clinicId);
    expect((await repo.getClinic(clinicId))!.verificationStatus).toBe("pending");
  });
});

describe("scheduling", () => {
  const rules = getPlaybook().personaRules;

  it("routes personas by the playbook, falling back when a channel is missing", () => {
    const scripts = ["silent", "engaged", "price_check"] as const;
    const twoForms = { formUrls: ["https://c.example/a", "https://c.example/b"], publicEmail: "hi@c.example" };
    expect(chooseRoutes(scripts, twoForms, rules).map((r) => r.target)).toEqual(["https://c.example/a", "hi@c.example", "https://c.example/b"]);
    expect(chooseRoutes(scripts, { formUrls: [], publicEmail: "hi@c.example" }, rules).every((r) => r.channel === "email")).toBe(true);
    expect(chooseRoutes(scripts, { formUrls: ["https://c.example/a"], publicEmail: null }, rules).every((r) => r.channel === "web_form")).toBe(true);
    expect(() => chooseRoutes(scripts, { formUrls: [], publicEmail: null }, rules)).toThrow(/no contact form/);
  });

  it("falls back to looser windows for short opening hours, and asks ops when nothing fits", async () => {
    const { deps, repo } = await makeDeps();
    const mornings = { ...DEFAULT_HOURS, mon: { open: "09:00", close: "12:00" }, tue: { open: "09:00", close: "12:00" }, wed: { open: "09:00", close: "12:00" }, thu: { open: "09:00", close: "12:00" }, fri: { open: "09:00", close: "12:00" } };
    const { orderId } = await placeOrder(deps, orderInput({ clinic: { hours: mornings } }));
    await handleOrderPaid(deps, orderId);
    await confirmBuyer(deps, orderId);
    const test = (await repo.testForOrder(orderId))!;
    expect(test.status).toBe("scheduled");

    // Open one hour on Saturdays, with every Saturday for months blacked out.
    const closed = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };
    const saturdays = Array.from({ length: 20 }, (_, i) => new Date(Date.UTC(2026, 9, 10 + 7 * i)).toISOString().slice(0, 10));
    const other = await placeOrder(
      deps,
      orderInput({
        email: "x@glowclinic2.example",
        clinic: { placeId: "ChIJother12345", website: "https://glowclinic2.example", publicEmail: "hi@glowclinic2.example", formUrls: [], hours: { ...closed, sat: { open: "09:00", close: "10:00" } }, blackoutDates: saturdays },
      }),
    );
    await handleOrderPaid(deps, other.orderId);
    const blocked = (await repo.testForOrder(other.orderId))!;
    await repo.setVerification(blocked.clinicId, "verified", "manual", NOW);
    const outcome = await scheduleTest(deps, blocked.id);
    expect(outcome).toMatchObject({ ok: false, reason: expect.stringMatching(/No send times/) });
    expect((await repo.getTest(blocked.id))!.statusNote).toMatch(/No send times/);
    expect((await repo.openTasks()).some((t) => t.type === "fix_failure")).toBe(true);
  });
});
