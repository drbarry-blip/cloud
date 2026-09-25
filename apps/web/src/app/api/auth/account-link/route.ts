import { z } from "zod";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { sendEmail } from "@/lib/email/mailer";
import { clientIp, error, json, parseBody } from "@/lib/http";
import { takeDaily } from "@/lib/rate-limit";
import { signInEmail } from "@/lib/shopper/emails";
import { ShopperRepo } from "@/lib/shopper/repo";
import { getStore } from "@/lib/store";
import { createToken } from "@/lib/tokens";

const Body = z.object({ email: z.email().max(254) });

/** Emails a sign-in link to customers who have ordered. The response is the same either way. */
export async function POST(request: Request) {
  const parsed = await parseBody(request, Body, 1000);
  if ("response" in parsed) return parsed.response;
  const store = await getStore();
  if (!(await takeDaily(store, "account-link:ip", clientIp(request), 10))) return error(429, "Too many requests today.");
  const lead = await store.getLeadByEmail(parsed.data.email);
  if (lead && (await new ShopperRepo(await getDb()).clinicsForLead(lead.id)).length > 0) {
    const url = `${config.siteUrl()}/account/verify?t=${encodeURIComponent(createToken("account", lead.id))}`;
    await sendEmail({ ...signInEmail({ url, forStaff: false }), to: lead.email }).catch((err: Error) => console.error("[auth] account link not sent:", err.message));
  }
  return json({ ok: true });
}
