import "server-only";
import { idOf, invoiceSubscriptionId, subscriptionMetadata, subscriptionPeriodEnd } from "../stripe";
import type { ShopperDeps } from "./deps";
import { handleOrderPaid } from "./purchase";
import { activateRetests, handleRetestPayment, mapStripeStatus } from "./retest";

type Obj = Record<string, unknown>;
export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Obj };
}

/**
 * Applies one Stripe webhook event. Every handler is idempotent, because Stripe
 * retries deliveries and can send events out of order.
 */
export async function handleStripeEvent(deps: ShopperDeps, event: StripeEvent): Promise<string> {
  const o = event.data.object;
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const meta = (o.metadata as Record<string, string> | undefined) ?? {};
      if (o.mode === "subscription") {
        const subId = idOf(o.subscription);
        if (!subId || !meta.clinicId || !meta.leadId) return "ignored: not a retest subscription";
        await activateRetests(deps, { clinicId: meta.clinicId, leadId: meta.leadId, stripeSubscriptionId: subId, customerId: idOf(o.customer), periodEnd: null });
        return "subscription active";
      }
      if (o.mode !== "payment") return "ignored: not a one-time payment";
      // Delayed payment methods complete first and succeed later.
      if (o.payment_status !== "paid" && o.payment_status !== "no_payment_required") return "waiting for payment";
      const orderId = meta.orderId ?? o.client_reference_id;
      if (typeof orderId !== "string") return "ignored: no order";
      return handleOrderPaid(deps, orderId, { paymentIntent: idOf(o.payment_intent), customerId: idOf(o.customer) });
    }
    case "invoice.paid": {
      const subId = invoiceSubscriptionId(o);
      if (!subId) return "ignored: not a subscription invoice";
      // The invoice can arrive before the checkout event, so fall back to its metadata.
      let sub = await deps.repo.subscriptionByStripeId(subId);
      if (!sub) {
        const meta = subscriptionMetadata(o);
        if (!meta.clinicId || !meta.leadId) return "ignored: unknown subscription";
        sub = await activateRetests(deps, { clinicId: meta.clinicId, leadId: meta.leadId, stripeSubscriptionId: subId, customerId: idOf(o.customer), periodEnd: null });
      }
      const amount = typeof o.amount_paid === "number" ? o.amount_paid : 0;
      return handleRetestPayment(deps, sub, { invoiceId: String(o.id), amountCents: amount });
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const status = event.type === "customer.subscription.deleted" ? "canceled" : mapStripeStatus(o.status);
      const updated = await deps.repo.setSubscriptionStatus(String(o.id), status, subscriptionPeriodEnd(o));
      return updated ? `subscription ${status}` : "ignored: unknown subscription";
    }
    default:
      return "ignored";
  }
}
