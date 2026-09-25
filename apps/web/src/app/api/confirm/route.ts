import { z } from "zod";
import { nurtureDueAt } from "@/lib/email/nurture";
import { error, json, parseBody } from "@/lib/http";
import { getStore } from "@/lib/store";
import { verifyToken } from "@/lib/tokens";

const Body = z.object({ token: z.string().max(500) });

/** Confirms an email address (double opt-in) and schedules the nurture sequence. */
export async function POST(request: Request) {
  const parsed = await parseBody(request, Body, 1000);
  if ("response" in parsed) return parsed.response;
  const leadId = verifyToken(parsed.data.token, "confirm");
  if (!leadId) return error(400, "This confirmation link is invalid or has expired.");
  const store = await getStore();
  const lead = await store.confirmLead(leadId, new Date());
  if (!lead) return error(404, "We couldn't find that sign-up.");
  if (lead.marketingConsent && !lead.unsubscribedAt && lead.nurtureStep === 0 && !lead.nurtureNextAt && lead.confirmedAt) {
    await store.setNurture(lead.id, 0, nurtureDueAt(lead.confirmedAt, 1));
  }
  return json({ ok: true });
}
