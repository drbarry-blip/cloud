import { afterEach, describe, expect, it, vi } from "vitest";
import type { Staff } from "@/lib/auth";
import { runTaskAction } from "@/lib/shopper/admin";
import type { ShopperDeps } from "@/lib/shopper/deps";
import { runShopperTick } from "@/lib/shopper/engine";
import { recordInboundEmail } from "@/lib/shopper/inbound";
import { confirmBuyer, handleOrderPaid } from "@/lib/shopper/purchase";
import { retestPlan, startRetestCheckout } from "@/lib/shopper/retest";
import { handleStripeEvent } from "@/lib/shopper/stripe-events";
import type { StripeClient } from "@/lib/stripe";
import { verifyToken } from "@/lib/tokens";
import { DAY, makeDeps, orderInput, placeOrder } from "./shopper-helpers";

afterEach(() => vi.restoreAllMocks());

const admin: Staff = { email: "admin@us.example", role: "admin" };
const va: Staff = { email: "va@us.example", role: "va" };

async function paidOrder(over: Partial<ShopperDeps> = {}, email = "someone@gmail.com") {
  const ctx = await makeDeps(over);
  const { orderId } = await placeOrder(ctx.deps, orderInput({ email }));
  await handleOrderPaid(ctx.deps, orderId, { paymentIntent: "pi_1" });
  const test = (await ctx.repo.testForOrder(orderId))!;
  return { ...ctx, orderId, test };
}

/** A baseline test graded and waiting for QA. */
async function inQa(over: Partial<ShopperDeps> = {}) {
  const ctx = await makeDeps({ formBot: { submit: async () => ({ status: "submitted", confirmation: "Thanks!" }) }, ...over });
  const { orderId } = await placeOrder(ctx.deps);
  await handleOrderPaid(ctx.deps, orderId);
  await confirmBuyer(ctx.deps, orderId);
  const test = (await ctx.repo.testForOrder(orderId))!;
  const last = Math.max(...(await ctx.repo.assignmentsForTest(test.id)).map((a) => a.scheduledAt.getTime()));
  ctx.clock.now = new Date(last + 60_000);
  await runShopperTick(ctx.deps);
  ctx.clock.now = new Date(last + 15 * DAY);
  await runShopperTick(ctx.deps);
  expect((await ctx.repo.getTest(test.id))!.status).toBe("qa");
  return { ...ctx, orderId, test };
}

describe("console permissions", () => {
  it("checks the task type, the person's role, and whether it's still open", async () => {
    const { deps, repo, test } = await paidOrder();
    const task = (await repo.openTaskFor("verify_ownership", { testId: test.id }))!;
    expect(await runTaskAction(deps, va, task.id, { action: "form_submitted" })).toMatchObject({ ok: false, status: 400 });
    expect(await runTaskAction(deps, va, task.id, { action: "reject", reason: "Nope" })).toMatchObject({ ok: false, status: 403 });
    const phi = await repo.createTask({ type: "review_phi", title: "PHI", testId: test.id });
    expect(await runTaskAction(deps, va, phi.id, { action: "phi_false_alarm" })).toMatchObject({ ok: false, status: 404 });
    expect(await runTaskAction(deps, va, task.id, { action: "verify", minutesSpent: 6 })).toEqual({ ok: true });
    expect(await runTaskAction(deps, va, task.id, { action: "verify" })).toMatchObject({ ok: false, status: 409 });
    expect((await repo.getTask(task.id))!).toMatchObject({ status: "done", completedBy: "va@us.example", minutesSpent: 6 });
    expect((await repo.getTest(test.id))!.status).toBe("scheduled");
    expect((await repo.auditFor("task", task.id)).map((a) => a.action)).toEqual(["task.verify"]);
  });

  it("lets an admin reject ownership, which cancels and refunds", async () => {
    const refund = vi.fn(async () => ({ id: "re_1", status: "succeeded" }));
    const { deps, repo, test, orderId } = await paidOrder({ stripe: { refund, createCheckoutSession: async () => ({ id: "cs", url: "https://x" }) } as unknown as StripeClient });
    const task = (await repo.openTaskFor("verify_ownership", { testId: test.id }))!;
    expect(await runTaskAction(deps, admin, task.id, { action: "reject", reason: "The owner says they didn't order this" })).toEqual({ ok: true });
    expect(refund).toHaveBeenCalledWith("pi_1");
    expect((await repo.getOrder(orderId))!.status).toBe("refunded");
    expect((await repo.getTest(test.id))!.status).toBe("cancelled");
  });
});

describe("cancelling", () => {
  it("refunds the unsent share and still grades what was sent", async () => {
    const refund = vi.fn(async () => ({ id: "re_2", status: "succeeded" }));
    const { deps, repo, clock, test, orderId } = await paidOrder({
      stripe: { refund, createCheckoutSession: async () => ({ id: "cs", url: "https://x" }) } as unknown as StripeClient,
      formBot: { submit: async () => ({ status: "submitted", confirmation: "Thanks!" }) },
    });
    await runTaskAction(deps, admin, (await repo.openTaskFor("verify_ownership", { testId: test.id }))!.id, { action: "verify" });
    const [first] = await repo.assignmentsForTest(test.id);
    clock.now = new Date(first!.scheduledAt.getTime() + 60_000);
    await runShopperTick(deps); // one of three sent
    const { cancelTest } = await import("@/lib/shopper/admin");
    expect(await cancelTest(deps, va, test.id, "prorated")).toMatchObject({ ok: false, status: 403 });
    expect(await cancelTest(deps, admin, test.id, "prorated")).toEqual({ ok: true });
    expect(refund).toHaveBeenCalledWith("pi_1", 13267); // two thirds of $199
    expect((await repo.getOrder(orderId))!.status).toBe("paid");
    expect((await repo.getTest(test.id))!.status).toBe("qa"); // partial report
    expect((await repo.assignmentsForTest(test.id)).map((a) => a.sendStatus).sort()).toEqual(["cancelled", "cancelled", "sent"]);
  });
});

describe("VA work on a running test", () => {
  it("records a form submitted by hand, or switches a broken form to email", async () => {
    const { deps, repo, clock, test } = await paidOrder();
    await runTaskAction(deps, va, (await repo.openTaskFor("verify_ownership", { testId: test.id }))!.id, { action: "verify" });
    const [silent] = await repo.assignmentsForTest(test.id);
    clock.now = new Date(silent!.scheduledAt.getTime() + 60_000);
    await runShopperTick(deps); // no browser configured: goes to a VA
    const task = (await repo.openTaskFor("submit_form", { assignmentId: silent!.id }))!;
    expect(await runTaskAction(deps, va, task.id, { action: "form_submitted", confirmation: "Thanks, we'll call you!" })).toEqual({ ok: true });
    const sent = (await repo.getAssignment(silent!.id))!;
    expect(sent).toMatchObject({ sendStatus: "sent", sentAt: clock.now });
    expect((await repo.outboundForTest(test.id))[0]).toMatchObject({ sentBy: "va:va@us.example", evidence: { confirmation: "Thanks, we'll call you!" } });
    expect((await repo.getTest(test.id))!.status).toBe("running");
  });

  it("turns a broken form into a finding and sends that persona by email instead", async () => {
    const { deps, repo, clock, sent, test } = await paidOrder();
    await runTaskAction(deps, va, (await repo.openTaskFor("verify_ownership", { testId: test.id }))!.id, { action: "verify" });
    const [silent] = await repo.assignmentsForTest(test.id);
    clock.now = new Date(silent!.scheduledAt.getTime() + 60_000);
    await runShopperTick(deps);
    const task = (await repo.openTaskFor("submit_form", { assignmentId: silent!.id }))!;
    await runTaskAction(deps, va, task.id, { action: "form_broken", note: "Submit button does nothing on mobile" });
    expect((await repo.getTest(test.id))!.findings).toMatchObject([{ kind: "form_broken" }]);
    await runShopperTick(deps);
    expect((await repo.getAssignment(silent!.id))!).toMatchObject({ sendStatus: "sent", channel: "email", target: "hello@glowclinic.example" });
    expect(sent.some((m) => m.from?.includes(silent!.email))).toBe(true);
  });

  it("matches a stray message to a persona and handles possible PHI", async () => {
    const { deps, repo, clock, sent, test } = await paidOrder({}, "owner@glowclinic.example");
    await confirmBuyer(deps, (await repo.getOrder(test.orderId!))!.id);
    const personas = await repo.assignmentsForTest(test.id);
    clock.now = new Date(personas[2]!.scheduledAt.getTime() + 60_000);
    await runShopperTick(deps);
    const engaged = personas.find((p) => p.script === "engaged")!;

    await recordInboundEmail(deps, { to: "typo@personas.example.net", from: "amy@glowclinic.example", subject: "Re: hi", text: "Hi! Want to come in Thursday?", messageId: "<stray@x>" });
    const match = (await repo.openTasks()).find((t) => t.type === "match_inbound")!;
    expect(await runTaskAction(deps, va, match.id, { action: "match", assignmentId: engaged.id })).toEqual({ ok: true });
    expect(await repo.openTaskFor("approve_reply", { assignmentId: engaged.id })).not.toBeNull();

    await recordInboundEmail(deps, { to: engaged.email, from: "amy@glowclinic.example", subject: "chart", text: "MRN 00412345 for your records", messageId: "<phi2@x>" });
    const phi = (await repo.openTasks()).find((t) => t.type === "review_phi")!;
    expect(await runTaskAction(deps, admin, phi.id, { action: "phi_confirmed" })).toEqual({ ok: true });
    expect((await repo.getInbound(phi.inboundEventId!))!.body).toBeNull();
    expect(sent.some((m) => m.to === "owner@glowclinic.example" && /Privacy notice/.test(m.subject))).toBe(true);
  });
});

describe("QA and delivery", () => {
  it("delivers the report with a working link and offers retests", async () => {
    const { deps, repo, sent, test } = await inQa();
    const qa = (await repo.openTaskFor("qa_report", { testId: test.id }))!;
    expect(await runTaskAction(deps, va, qa.id, { action: "approve_report", headline: "  Two of three inquiries never got a personal reply.  " })).toEqual({ ok: true });
    const delivered = (await repo.getTest(test.id))!;
    expect(delivered).toMatchObject({ status: "delivered", headlineOverride: "Two of three inquiries never got a personal reply." });
    const email = sent.find((m) => m.subject.startsWith("Your Secret Shopper report"))!;
    const link = /https:\/\/app\.example\/report\/(\S+)/.exec(email.text)![1]!;
    expect(verifyToken(decodeURIComponent(link), "report")).toBe(test.id);
    expect(email.text).toContain("Two of three inquiries never got a personal reply.");
    expect(email.text).toContain("Add Monthly Retests");
    expect(await runTaskAction(deps, va, qa.id, { action: "approve_report" })).toMatchObject({ ok: false, status: 409 });
  });
});

describe("monthly retests", () => {
  it("rotates two-inquiry retests and makes every third cycle a full test", () => {
    const baseline = ["silent", "engaged", "price_check"] as const;
    const plans: { kind: string; scripts: string[] }[] = [];
    for (let i = 0; i < 6; i++) plans.push(retestPlan(plans, baseline));
    expect(plans.map((p) => p.kind)).toEqual(["retest", "retest", "quarterly", "retest", "retest", "quarterly"]);
    expect(plans[0]!.scripts).toEqual(["silent", "price_check"]);
    expect(plans[1]!.scripts).toEqual(["engaged", "silent"]);
    expect(plans[3]!.scripts).toEqual(["price_check", "engaged"]);
  });

  it("starts after a delivered report, queues behind a running test, and alerts once on silence", async () => {
    const { deps, repo, clock, sent, test } = await inQa();
    const clinicId = test.clinicId;
    const owner = (await repo.getClinic(clinicId))!.ownerLeadId;
    expect(await startRetestCheckout(deps, clinicId, owner)).toMatchObject({ ok: false, status: 409 }); // no report yet
    await runTaskAction(deps, admin, (await repo.openTaskFor("qa_report", { testId: test.id }))!.id, { action: "approve_report" });

    expect(await startRetestCheckout(deps, clinicId, "00000000-0000-4000-8000-000000000000")).toMatchObject({ ok: false, status: 404 });
    expect(await startRetestCheckout(deps, clinicId, owner)).toMatchObject({ ok: true });
    expect(await startRetestCheckout(deps, clinicId, owner)).toMatchObject({ ok: false, status: 409 });
    const [sub] = await repo.subscriptionsForClinic(clinicId);
    const [retest] = await repo.testsForSubscription(sub!.id);
    expect(retest).toMatchObject({ kind: "retest", status: "scheduled", scripts: ["silent", "price_check"] });
    const personas = await repo.assignmentsForTest(retest!.id);
    expect(personas.map((p) => p.channel).sort()).toEqual(["email", "web_form"]);

    // Send both, then two quiet days: one alert per inquiry, never repeated.
    clock.now = new Date(personas[1]!.scheduledAt.getTime() + 60_000);
    await runShopperTick(deps);
    clock.now = new Date(clock.now.getTime() + 3 * DAY);
    expect((await runShopperTick(deps)).alerts).toBe(2);
    expect((await runShopperTick(deps)).alerts).toBe(0);
    expect(sent.filter((m) => m.subject.startsWith("Alert:")).length).toBe(2);
  });

  it("handles Stripe subscription events in any order, once", async () => {
    const { deps, repo, test } = await inQa();
    await runTaskAction(deps, admin, (await repo.openTaskFor("qa_report", { testId: test.id }))!.id, { action: "approve_report" });
    const clinic = (await repo.getClinic(test.clinicId))!;
    const meta = { clinicId: clinic.id, leadId: clinic.ownerLeadId, product: "retest_monthly" };
    const invoice = { id: "in_1", type: "invoice.paid", data: { object: { id: "in_1", amount_paid: 9900, customer: "cus_1", parent: { subscription_details: { subscription: "sub_1", metadata: meta } } } } };

    // The invoice arrives before the checkout event.
    expect(await handleStripeEvent(deps, invoice)).toBe("processed");
    expect(await handleStripeEvent(deps, invoice)).toBe("duplicate");
    expect(await handleStripeEvent(deps, { id: "evt_c", type: "checkout.session.completed", data: { object: { mode: "subscription", subscription: "sub_1", customer: "cus_1", metadata: meta } } })).toBe("subscription active");
    const sub = (await repo.subscriptionByStripeId("sub_1"))!;
    expect((await repo.testsForSubscription(sub.id)).length).toBe(1);

    // A second paid month while the first retest is still running: it waits its turn.
    expect(await handleStripeEvent(deps, { ...invoice, id: "in_2", data: { object: { ...invoice.data.object, id: "in_2" } } })).toBe("processed");
    const tests = await repo.testsForSubscription(sub.id);
    expect(tests.map((t) => t.status)).toEqual(["scheduled", "awaiting_payment"]);

    expect(await handleStripeEvent(deps, { id: "evt_d", type: "customer.subscription.deleted", data: { object: { id: "sub_1", status: "canceled" } } })).toBe("subscription canceled");
    expect((await repo.subscriptionByStripeId("sub_1"))!.status).toBe("canceled");
  });
});
