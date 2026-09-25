import { config } from "@/lib/config";
import { error, json } from "@/lib/http";
import { liveShopperDeps } from "@/lib/shopper/deps";
import { handleStripeEvent, type StripeEvent } from "@/lib/shopper/stripe-events";
import { verifyStripeSignature } from "@/lib/stripe";

/** Stripe webhook. The signature is checked against the raw body before anything is parsed. */
export async function POST(request: Request) {
  const stripe = config.stripe();
  if (!stripe) return error(404, "Not found.");
  const body = await request.text();
  if (body.length > 1_000_000) return error(413, "Too large.");
  if (!verifyStripeSignature(body, request.headers.get("stripe-signature"), stripe.webhookSecret)) return error(400, "Bad signature.");
  const event = JSON.parse(body) as StripeEvent;
  try {
    const outcome = await handleStripeEvent(await liveShopperDeps(), event);
    console.info(`[stripe] ${event.type} ${event.id}: ${outcome}`);
    return json({ received: true });
  } catch (err) {
    // A 500 makes Stripe retry; every handler is idempotent.
    console.error(`[stripe] ${event.type} ${event.id} failed:`, (err as Error).message);
    return error(500, "Webhook handling failed.");
  }
}
