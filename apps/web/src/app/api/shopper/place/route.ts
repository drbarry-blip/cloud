import { z } from "zod";
import { config } from "@/lib/config";
import { GoogleApiError, getPlaceForSetup } from "@/lib/google";
import { clientIp, error, json, parseBody } from "@/lib/http";
import { takeDaily } from "@/lib/rate-limit";
import { getStore } from "@/lib/store";

const Body = z.object({ placeId: z.string().regex(/^[A-Za-z0-9_-]{10,300}$/) });

/** Pre-fills the Secret Shopper setup form from the clinic's Google listing. The owner confirms every field. */
export async function POST(request: Request) {
  const parsed = await parseBody(request, Body, 1000);
  if ("response" in parsed) return parsed.response;
  const key = config.googleMapsKey();
  if (!key) return error(503, "Google lookup isn't available. Please enter the details by hand.");
  if (!(await takeDaily(await getStore(), "shopper-place:ip", clientIp(request), 30))) return error(429, "Too many lookups today. Please enter the details by hand.");
  try {
    return json({ place: await getPlaceForSetup(key, parsed.data.placeId) });
  } catch (err) {
    console.error("[shopper] place lookup failed:", err instanceof GoogleApiError ? err.status : (err as Error).name);
    return error(502, "Google isn't responding. Please enter the details by hand.");
  }
}
