import { z } from "zod";
import { config } from "@/lib/config";
import { sendEmail } from "@/lib/email/mailer";
import { confirmEmail } from "@/lib/email/templates";
import { clientIp, error, json, parseBody } from "@/lib/http";
import { takeDaily } from "@/lib/rate-limit";
import { getStore } from "@/lib/store";
import { createToken } from "@/lib/tokens";

const Body = z.object({
  email: z.email("Enter a valid email address.").max(254),
  source: z.enum(["reply_checker", "visibility_score", "secret_shopper_waitlist"]),
  marketingConsent: z.boolean(),
  scanId: z.uuid().optional(),
});

/**
 * Captures an email. Returns a lead token that unlocks rewrites and higher limits.
 * Marketing email starts only after the person clicks the confirmation link (double opt-in).
 */
export async function POST(request: Request) {
  const parsed = await parseBody(request, Body, 2000);
  if ("response" in parsed) return parsed.response;
  const { email, source, marketingConsent, scanId } = parsed.data;
  const store = getStore();

  if (!(await takeDaily(store, "leads:ip", clientIp(request), config.limits().leadsPerDayPerIp))) {
    return error(429, "Too many sign-ups from this connection today.");
  }

  const lead = await store.upsertLead({ email, source, marketingConsent });
  const scan = scanId ? await store.getVisibilityScan(scanId) : null;
  const needsConfirmation = lead.marketingConsent && !lead.confirmedAt && !lead.unsubscribedAt;

  if (scan || needsConfirmation) {
    try {
      await sendEmail({ ...confirmEmail(lead.id, { marketingConsent: needsConfirmation, scan: scan ?? undefined }), to: lead.email });
    } catch (err) {
      console.error("[leads] email not sent:", (err as Error).message);
    }
  }

  return json({ leadToken: createToken("lead", lead.id), confirmationSent: needsConfirmation });
}
