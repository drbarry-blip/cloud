import { z } from "zod";
import { error, json, parseBody } from "@/lib/http";
import { liveShopperDeps } from "@/lib/shopper/deps";
import { handleOrderPaid } from "@/lib/shopper/purchase";
import { verifyToken } from "@/lib/tokens";

const Body = z.object({ token: z.string().max(500) });

/** Development only: stands in for a successful Stripe payment. */
export async function POST(request: Request) {
  const deps = await liveShopperDeps();
  if (!deps.allowSimulatedCheckout || deps.stripe) return error(404, "Not found.");
  const parsed = await parseBody(request, Body, 1000);
  if ("response" in parsed) return parsed.response;
  const orderId = verifyToken(parsed.data.token, "order");
  if (!orderId) return error(400, "This checkout link is invalid.");
  const outcome = await handleOrderPaid(deps, orderId, { paymentIntent: `pi_dev_${orderId.slice(0, 8)}` });
  if (outcome === "missing") return error(404, "We couldn't find that order.");
  return json({ ok: true });
}
