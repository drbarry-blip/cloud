import { z } from "zod";
import { getAccountLeadId, sameOrigin } from "@/lib/auth";
import { error, json, parseBody } from "@/lib/http";
import { liveShopperDeps } from "@/lib/shopper/deps";
import { startRetestCheckout } from "@/lib/shopper/retest";
import { StripeError } from "@/lib/stripe";

const Body = z.object({ clinicId: z.uuid() });

/** Starts Monthly Retests for one of the signed-in customer's clinics. */
export async function POST(request: Request) {
  const leadId = await getAccountLeadId();
  if (!leadId) return error(401, "Please sign in again.");
  if (!sameOrigin(request)) return error(403, "Cross-site request blocked.");
  const parsed = await parseBody(request, Body, 1000);
  if ("response" in parsed) return parsed.response;
  try {
    const res = await startRetestCheckout(await liveShopperDeps(), parsed.data.clinicId, leadId);
    return res.ok ? json({ url: res.url }) : error(res.status, res.message);
  } catch (err) {
    console.error("[account] retest checkout failed:", err instanceof StripeError ? `stripe ${err.status}` : (err as Error).message);
    return error(502, "We couldn't start checkout. Please try again in a minute.");
  }
}
