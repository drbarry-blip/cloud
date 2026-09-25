import "server-only";
import { randomInt } from "node:crypto";
import type { ScriptId } from "@cgs/core";
import type { ShopperDeps } from "./deps";
import { noResponseAlertEmail } from "./emails";
import { trySend } from "./deps";
import { PRICES, type Result } from "./purchase";
import type { Subscription } from "./repo";
import { scheduleTest } from "./schedule";

// Monthly Retests (SPEC.md §7.1): two inquiries a month (one form, one email, with
// scripts and services rotating), a full three-persona test every third cycle, and
// alerts. Each paid invoice creates one test; it waits if another test is running.

const DAY = 24 * 60 * 60 * 1000;
// Pairs chosen so each month has one form-first and one email-first script.
const ROTATION: ScriptId[][] = [
  ["silent", "price_check"],
  ["engaged", "silent"],
  ["price_check", "engaged"],
];

/** What the next test on a subscription looks like, given how many it has had. */
export function retestPlan(previous: { kind: string }[], baseline: readonly ScriptId[]): { kind: "retest" | "quarterly"; scripts: ScriptId[] } {
  if ((previous.length + 1) % 3 === 0) return { kind: "quarterly", scripts: [...baseline] };
  const monthly = previous.filter((t) => t.kind === "retest").length;
  return { kind: "retest", scripts: ROTATION[monthly % ROTATION.length]! };
}

/** Starts a Monthly Retest subscription for a clinic whose baseline report was delivered. */
export async function startRetestCheckout(deps: ShopperDeps, clinicId: string, leadId: string): Promise<Result<{ url: string }>> {
  const { repo } = deps;
  const clinic = await repo.getClinic(clinicId);
  if (!clinic || clinic.ownerLeadId !== leadId) return { ok: false, status: 404, message: "We couldn't find that clinic on your account." };
  if ((await repo.deliveredTests(clinicId)).length === 0) return { ok: false, status: 409, message: "Monthly Retests start after your first report is delivered." };
  if ((await repo.subscriptionsForClinic(clinicId)).some((s) => s.status !== "canceled")) {
    return { ok: false, status: 409, message: "This clinic already has Monthly Retests." };
  }
  const lead = (await deps.store.getLead(leadId))!;
  const price = PRICES.retest_monthly;
  if (deps.stripe) {
    const customerId = (await repo.ordersForClinic(clinicId)).find((o) => o.stripeCustomerId)?.stripeCustomerId ?? null;
    const session = await deps.stripe.createCheckoutSession({
      mode: "subscription",
      productName: `${price.name}: ${clinic.name}`,
      amountCents: price.cents,
      customerId,
      customerEmail: lead.email,
      clientReferenceId: clinicId,
      metadata: { clinicId, leadId, product: "retest_monthly" },
      successUrl: `${deps.siteUrl}/account?retests=started`,
      cancelUrl: `${deps.siteUrl}/account`,
      idempotencyKey: `retest-${clinicId}-${deps.now().toISOString().slice(0, 10)}`,
    });
    return { ok: true, url: session.url };
  }
  if (!deps.allowSimulatedCheckout) return { ok: false, status: 503, message: "Checkout isn't available right now." };
  // Development: act as if Stripe confirmed the subscription and its first invoice.
  const sub = await activateRetests(deps, { clinicId, leadId, stripeSubscriptionId: `sub_dev_${clinicId.slice(0, 8)}`, customerId: null, periodEnd: new Date(deps.now().getTime() + 30 * DAY) });
  await handleRetestPayment(deps, sub, { invoiceId: `in_dev_${clinicId.slice(0, 8)}_${deps.now().getTime()}`, amountCents: price.cents });
  return { ok: true, url: `${deps.siteUrl}/account?retests=started` };
}

export function activateRetests(
  deps: ShopperDeps,
  s: { clinicId: string; leadId: string; stripeSubscriptionId: string; customerId: string | null; periodEnd: Date | null },
): Promise<Subscription> {
  return deps.repo.upsertSubscription({
    clinicId: s.clinicId,
    leadId: s.leadId,
    stripeSubscriptionId: s.stripeSubscriptionId,
    stripeCustomerId: s.customerId,
    status: "active",
    currentPeriodEnd: s.periodEnd,
  });
}

/** One paid invoice = one retest. Idempotent by invoice ID. */
export async function handleRetestPayment(deps: ShopperDeps, sub: Subscription, invoice: { invoiceId: string; amountCents: number }): Promise<"processed" | "duplicate"> {
  const { repo, playbook } = deps;
  if (await repo.orderByInvoice(invoice.invoiceId)) return "duplicate";
  const plan = retestPlan(await repo.testsForSubscription(sub.id), playbook.personaRules.test_mix.baseline);
  await repo.transaction(async (tx) => {
    const order = await tx.createOrder({ clinicId: sub.clinicId, leadId: sub.leadId, product: "retest_monthly", amountCents: invoice.amountCents, subscriptionId: sub.id });
    await tx.markOrderPaid(order.id, { paidAt: deps.now(), invoiceId: invoice.invoiceId });
    await tx.createTest({
      clinicId: sub.clinicId,
      orderId: order.id,
      subscriptionId: sub.id,
      kind: plan.kind,
      // Queued until the clinic has no other active test.
      status: "awaiting_payment",
      scripts: plan.scripts,
      seed: randomInt(1, 2 ** 31 - 1),
      playbookVersion: playbook.version,
    });
    await tx.audit("stripe", "retest.paid", { type: "subscription", id: sub.id }, { kind: plan.kind });
  });
  await promoteQueuedRetests(deps);
  return "processed";
}

/** Starts queued retests whose clinic is free. Runs on every scheduler tick. */
export async function promoteQueuedRetests(deps: ShopperDeps): Promise<number> {
  const { repo } = deps;
  let started = 0;
  for (const test of await repo.queuedRetests()) {
    const moved = await repo.transitionTest(test.id, ["awaiting_payment"], "awaiting_verification", "Starting");
    if (!moved) continue; // the clinic still has an active test
    const clinic = (await repo.getClinic(test.clinicId))!;
    if (clinic.verificationStatus === "verified" && (await scheduleTest(deps, test.id)).ok) started++;
  }
  return started;
}

const STRIPE_STATUS: Record<string, Subscription["status"]> = {
  active: "active",
  trialing: "active",
  past_due: "past_due",
  unpaid: "past_due",
  incomplete: "past_due",
  canceled: "canceled",
  incomplete_expired: "canceled",
  paused: "canceled",
};
export const mapStripeStatus = (status: unknown): Subscription["status"] => STRIPE_STATUS[String(status)] ?? "past_due";

/**
 * Retest alert: an inquiry has gone 48 hours with no personal response. Sent once
 * per inquiry, and only for Monthly Retests (the owner asked to be told).
 */
export async function noResponseAlerts(deps: ShopperDeps): Promise<number> {
  const { repo } = deps;
  const cutoff = deps.now().getTime() - 2 * DAY;
  let sent = 0;
  for (const test of await repo.testsWithStatus(["running"])) {
    if (!test.subscriptionId) continue;
    const events = await repo.inboundForTest(test.id);
    for (const a of await repo.assignmentsForTest(test.id)) {
      if (!a.sentAt || a.sentAt.getTime() > cutoff) continue;
      if (events.some((e) => e.assignmentId === a.id && e.label === "personal" && !e.late)) continue;
      if (await repo.hasAudit("alert.no_response", "assignment", a.id)) continue;
      const clinic = (await repo.getClinic(test.clinicId))!;
      const lead = await deps.store.getLead(clinic.ownerLeadId);
      await repo.audit("system", "alert.no_response", { type: "assignment", id: a.id }, {});
      if (lead && (await trySend(deps, { ...noResponseAlertEmail({ clinicName: clinic.name, accountUrl: `${deps.siteUrl}/account` }), to: lead.email }, "no-response alert"))) sent++;
    }
  }
  return sent;
}
