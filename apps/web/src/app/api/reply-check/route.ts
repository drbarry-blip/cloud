import { z } from "zod";
import { claudeReviewer } from "@/lib/ai";
import { config } from "@/lib/config";
import { clientIp, error, json, parseBody } from "@/lib/http";
import { getPlaybook } from "@/lib/playbook";
import { takeDaily } from "@/lib/rate-limit";
import { runReplyCheck } from "@/lib/reply-check";
import { getStore } from "@/lib/store";
import { verifyToken } from "@/lib/tokens";
import { verifyTurnstile } from "@/lib/turnstile";

// PRIVACY: the pasted reply and review may contain patient details by accident.
// They're processed in memory only: never stored, never logged (SPEC.md §7.3).

const Body = z.object({
  reply: z.string().trim().min(10, "Paste the reply you plan to post (at least a few words).").max(3000, "Replies are limited to 3,000 characters."),
  review: z.string().trim().max(5000, "Reviews are limited to 5,000 characters.").optional(),
  clinicType: z.string().max(50).optional(),
  contactRole: z.string().trim().max(60).optional(),
  contactPhone: z.string().trim().max(30).optional(),
  leadToken: z.string().max(500).optional(),
  turnstileToken: z.string().max(2048).optional(),
});

export async function POST(request: Request) {
  const parsed = await parseBody(request, Body);
  if ("response" in parsed) return parsed.response;
  const body = parsed.data;
  const ip = clientIp(request);

  if (!(await verifyTurnstile(body.turnstileToken, ip))) return error(403, "Please complete the check that you're human, then try again.");

  const playbook = getPlaybook();
  if (body.clinicType && !playbook.clinicTypes[body.clinicType]) return error(400, "Unknown clinic type.");

  const store = await getStore();
  const leadId = verifyToken(body.leadToken, "lead");
  const limits = config.limits();
  const allowed = leadId
    ? await takeDaily(store, "reply-check:lead", leadId, limits.replyChecksPerDayWithEmail)
    : await takeDaily(store, "reply-check:ip", ip, limits.replyChecksPerDayAnonymous);
  if (!allowed) {
    return error(429, leadId ? "You've reached today's limit. Please come back tomorrow." : "You've used today's free checks. Enter your email to unlock more.", { needsEmail: !leadId });
  }

  const result = await runReplyCheck(
    {
      reply: body.reply,
      review: body.review,
      clinicTypeId: body.clinicType,
      contact: { role: body.contactRole, phone: body.contactPhone },
      includeRewrites: Boolean(leadId),
    },
    playbook,
    claudeReviewer(),
  );

  await store
    .recordReplyCheck({
      verdict: result.verdict,
      categories: [...new Set(result.flags.map((f) => f.category))],
      clinicType: body.clinicType ?? null,
      mode: result.mode,
      leadId,
    })
    .catch((err: Error) => console.error("[reply-check] metadata not saved:", err.name));

  return json(result);
}
