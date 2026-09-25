import { z } from "zod";
import { config } from "@/lib/config";
import { GoogleApiError, searchPlaces } from "@/lib/google";
import { clientIp, error, json, parseBody } from "@/lib/http";
import { takeDaily } from "@/lib/rate-limit";
import { getStore } from "@/lib/store";

const Body = z.object({
  query: z.string().trim().min(3, "Type your clinic's name and city.").max(120),
});

/** Finds the clinic's Google listing so the owner can pick it. */
export async function POST(request: Request) {
  const parsed = await parseBody(request, Body, 2000);
  if ("response" in parsed) return parsed.response;
  const key = config.googleMapsKey();
  if (!key) return error(503, "The Visibility Score isn't configured yet (missing Google API key).");
  if (!(await takeDaily(await getStore(), "places-search:ip", clientIp(request), 30))) return error(429, "Too many searches today. Please try again tomorrow.");
  try {
    const places = await searchPlaces(key, parsed.data.query, { pageSize: 5 });
    return json({ places: places.map((p) => ({ id: p.id, name: p.name, address: p.address })) });
  } catch (err) {
    console.error("[places] search failed:", err instanceof GoogleApiError ? err.status : (err as Error).name);
    return error(502, "Google search isn't responding. Please try again in a minute.");
  }
}
