import { z } from "zod";
import { config } from "@/lib/config";
import { error, json } from "@/lib/http";
import { liveShopperDeps } from "@/lib/shopper/deps";
import { recordInboundEmail } from "@/lib/shopper/inbound";
import { verifyTimestampedSignature } from "@/lib/signing";

const Body = z.object({
  to: z.string().max(320),
  from: z.string().max(500),
  subject: z.string().max(2000).nullish(),
  text: z.string().max(500_000).nullish(),
  html: z.string().max(1_000_000).nullish(),
  headers: z.record(z.string(), z.string()).default({}),
  messageId: z.string().max(1000).nullish(),
  receivedAt: z.iso.datetime().nullish(),
  attachmentNames: z.array(z.string().max(300)).max(50).default([]),
});

/**
 * Email to persona addresses, posted by the inbound email worker
 * (workers/inbound-email) and signed with INBOUND_EMAIL_SECRET.
 */
export async function POST(request: Request) {
  const secret = config.inboundEmailSecret();
  if (!secret) return error(404, "Not found.");
  const raw = await request.text();
  if (raw.length > 2_000_000) return error(413, "Too large.");
  if (!verifyTimestampedSignature(raw, request.headers.get("x-inbound-signature"), secret)) return error(401, "Bad signature.");
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return error(400, "Invalid JSON.");
  }
  const parsed = Body.safeParse(payload);
  if (!parsed.success) return error(400, "Invalid payload.");
  const m = parsed.data;
  const outcome = await recordInboundEmail(await liveShopperDeps(), {
    ...m,
    receivedAt: m.receivedAt ? new Date(m.receivedAt) : undefined,
  });
  return json(outcome);
}
