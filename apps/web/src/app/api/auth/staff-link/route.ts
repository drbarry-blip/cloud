import { z } from "zod";
import { staffLinkToken, staffRole } from "@/lib/auth";
import { config } from "@/lib/config";
import { sendEmail } from "@/lib/email/mailer";
import { clientIp, error, json, parseBody } from "@/lib/http";
import { takeDaily } from "@/lib/rate-limit";
import { signInEmail } from "@/lib/shopper/emails";
import { getStore } from "@/lib/store";

const Body = z.object({ email: z.email().max(254) });

/** Emails a console sign-in link to staff. The response never says whether the address is on the team. */
export async function POST(request: Request) {
  const parsed = await parseBody(request, Body, 1000);
  if ("response" in parsed) return parsed.response;
  if (!(await takeDaily(await getStore(), "staff-link:ip", clientIp(request), 10))) return error(429, "Too many requests today.");
  const email = parsed.data.email.trim().toLowerCase();
  if (staffRole(email)) {
    const url = `${config.siteUrl()}/admin/verify?t=${encodeURIComponent(staffLinkToken(email))}`;
    await sendEmail({ ...signInEmail({ url, forStaff: true }), to: email }).catch((err: Error) => console.error("[auth] staff link not sent:", err.message));
  }
  return json({ ok: true });
}
