import { timingSafeEqual } from "node:crypto";
import { config } from "@/lib/config";
import { runNurture } from "@/lib/email/nurture";
import { error, json } from "@/lib/http";
import { getStore } from "@/lib/store";

/** Sends due nurture emails. Call hourly from a scheduler with `Authorization: Bearer $CRON_SECRET`. */
export async function POST(request: Request) {
  const secret = config.cronSecret();
  if (!secret) return error(503, "CRON_SECRET is not configured.");
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return error(401, "Unauthorized.");
  return json(await runNurture(getStore()));
}
