import { z } from "zod";
import { error, json, parseBody } from "@/lib/http";
import { liveShopperDeps } from "@/lib/shopper/deps";
import { checkClinicCode, sendClinicCode } from "@/lib/shopper/purchase";
import { verifyToken } from "@/lib/tokens";

const Body = z.union([
  z.object({ token: z.string().max(500), action: z.literal("send") }),
  z.object({ token: z.string().max(500), code: z.string().trim().max(12) }),
]);

/** Sends a verification code to the clinic's public email, or checks one the owner entered. */
export async function POST(request: Request) {
  const parsed = await parseBody(request, Body, 1000);
  if ("response" in parsed) return parsed.response;
  const orderId = verifyToken(parsed.data.token, "order");
  if (!orderId) return error(400, "This order link is invalid.");
  const deps = await liveShopperDeps();
  const res = "code" in parsed.data ? await checkClinicCode(deps, orderId, parsed.data.code) : await sendClinicCode(deps, orderId);
  return res.ok ? json({ ok: true }) : error(res.status, res.message);
}
