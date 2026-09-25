import { config } from "@/lib/config";
import { runNurture } from "@/lib/email/nurture";
import { cronAuthError, json } from "@/lib/http";
import { getStore } from "@/lib/store";

/** Sends due nurture emails. Call hourly from a scheduler with `Authorization: Bearer $CRON_SECRET`. */
export async function POST(request: Request) {
  const denied = cronAuthError(request, config.cronSecret());
  if (denied) return denied;
  return json(await runNurture(await getStore()));
}
