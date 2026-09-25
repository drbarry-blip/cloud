import { z } from "zod";
import { getStaff } from "@/lib/auth";
import { config } from "@/lib/config";
import { clientIp, error, json, parseBody } from "@/lib/http";
import { takeDaily } from "@/lib/rate-limit";
import { liveShopperDeps } from "@/lib/shopper/deps";
import { startBaselineOrder, StartOrderSchema } from "@/lib/shopper/purchase";
import { StripeError } from "@/lib/stripe";
import { verifyTurnstile } from "@/lib/turnstile";

const Body = StartOrderSchema.extend({ turnstileToken: z.string().max(4000).optional() });

/** Saves the clinic setup and starts checkout for a Baseline Test. */
export async function POST(request: Request) {
  // Staff can order before launch, for the test-clinic dry run.
  if (!config.shopperOpen() && !(await getStaff())) return error(403, "The Secret Shopper isn't open for orders yet.");
  const parsed = await parseBody(request, Body, 20_000);
  if ("response" in parsed) return parsed.response;
  const ip = clientIp(request);
  if (!(await verifyTurnstile(parsed.data.turnstileToken, ip))) return error(400, "Please complete the security check and try again.");
  const deps = await liveShopperDeps();
  if (!(await takeDaily(deps.store, "shopper-order:ip", ip, 10))) return error(429, "Too many orders from this connection today.");
  try {
    const { turnstileToken: _t, ...input } = parsed.data;
    const res = await startBaselineOrder(deps, input);
    return res.ok ? json({ orderId: res.orderId, checkoutUrl: res.checkoutUrl }) : error(res.status, res.message);
  } catch (err) {
    console.error("[shopper] order failed:", err instanceof StripeError ? `stripe ${err.status} ${err.code ?? ""}` : (err as Error).message);
    return error(502, "We couldn't start checkout. Please try again in a minute.");
  }
}
