import { z } from "zod";
import { accountCookie } from "@/lib/auth";
import { error, json, parseBody } from "@/lib/http";
import { getStore } from "@/lib/store";
import { verifyToken } from "@/lib/tokens";

const Body = z.object({ token: z.string().max(500) });

/** Completes customer sign-in. Signing in also confirms the email address. */
export async function POST(request: Request) {
  const parsed = await parseBody(request, Body, 1000);
  if ("response" in parsed) return parsed.response;
  const leadId = verifyToken(parsed.data.token, "account");
  if (!leadId) return error(400, "This sign-in link is invalid or has expired.");
  await (await getStore()).confirmLead(leadId, new Date());
  const res = json({ ok: true });
  res.cookies.set(accountCookie(leadId));
  return res;
}
