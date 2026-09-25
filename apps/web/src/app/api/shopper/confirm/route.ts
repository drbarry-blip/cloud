import { z } from "zod";
import { error, json, parseBody } from "@/lib/http";
import { liveShopperDeps } from "@/lib/shopper/deps";
import { confirmBuyer } from "@/lib/shopper/purchase";
import { verifyToken } from "@/lib/tokens";

const Body = z.object({ token: z.string().max(500) });

/** The buyer confirms their email address; a matching website domain verifies the clinic. */
export async function POST(request: Request) {
  const parsed = await parseBody(request, Body, 1000);
  if ("response" in parsed) return parsed.response;
  const orderId = verifyToken(parsed.data.token, "buyer_confirm");
  if (!orderId) return error(400, "This link is invalid or has expired.");
  const res = await confirmBuyer(await liveShopperDeps(), orderId);
  return res.ok ? json({ ok: true }) : error(res.status, res.message);
}
