import { z } from "zod";
import { config } from "@/lib/config";
import { GoogleApiError } from "@/lib/google";
import { clientIp, error, json, parseBody } from "@/lib/http";
import { getPlaybook } from "@/lib/playbook";
import { takeDaily } from "@/lib/rate-limit";
import { getStore } from "@/lib/store";
import { verifyTurnstile } from "@/lib/turnstile";
import { buildVisibilityReport, liveDeps } from "@/lib/visibility";

export const maxDuration = 120;

const Body = z.object({
  placeId: z.string().regex(/^[A-Za-z0-9_-]{10,300}$/, "Pick your clinic from the search results."),
  clinicType: z.string().max(50),
  turnstileToken: z.string().max(2048).optional(),
});

export async function POST(request: Request) {
  const parsed = await parseBody(request, Body, 4000);
  if ("response" in parsed) return parsed.response;
  const { placeId, clinicType, turnstileToken } = parsed.data;
  const ip = clientIp(request);

  const key = config.googleMapsKey();
  if (!key) return error(503, "The Visibility Score isn't configured yet (missing Google API key).");
  const playbook = getPlaybook();
  if (!playbook.clinicTypes[clinicType]) return error(400, "Pick a clinic type.");
  if (!(await verifyTurnstile(turnstileToken, ip))) return error(403, "Please complete the check that you're human, then try again.");

  const store = await getStore();
  const limits = config.limits();
  if (!(await takeDaily(store, "visibility:ip", ip, limits.visibilityScoresPerDayPerIp))) {
    return error(429, "You've run today's free scores. Please come back tomorrow.");
  }
  // A global cap keeps Google API spend predictable if the tool is abused.
  if (!(await takeDaily(store, "visibility:total", "all", limits.visibilityScoresPerDayTotal))) {
    return error(503, "We've hit today's capacity for free scores. Please try again tomorrow.");
  }

  try {
    const report = await buildVisibilityReport(placeId, clinicType, playbook, liveDeps(key, config.pagespeedKey()));
    const scanId = await store.saveVisibilityScan({
      placeId: report.clinic.placeId,
      clinicType,
      clinicName: report.clinic.name,
      total: report.result.total,
      pillars: report.result.pillars.map((p) => ({ id: p.id, label: p.label, score: p.score, maxPoints: p.maxPoints })),
      quickWins: report.result.quickWins.map((w) => w.text),
      playbookVersion: report.playbookVersion,
    });
    return json({ scanId, report });
  } catch (err) {
    console.error("[visibility] failed:", err instanceof GoogleApiError ? `google ${err.status}` : (err as Error).name);
    return error(502, "We couldn't finish the check. Please try again in a minute.");
  }
}
