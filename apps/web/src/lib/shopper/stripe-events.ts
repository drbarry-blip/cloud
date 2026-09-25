import "server-only";
import { idOf } from "../stripe";
import type { ShopperDeps } from "./deps";
import { handleOrderPaid } from "./purchase";

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
      if (o.mode !== "payment") return "ignored: not a one-time payment";
      // Delayed payment methods complete first and succeed later.
      if (o.payment_status !== "paid" && o.payment_status !== "no_payment_required") return "waiting for payment";
      const orderId = (o.metadata as Obj | undefined)?.orderId ?? o.client_reference_id;
      if (typeof orderId !== "string") return "ignored: no order";
      return handleOrderPaid(deps, orderId, { paymentIntent: idOf(o.payment_intent), customerId: idOf(o.customer) });
    }
    default:
      return "ignored";
  }
}
