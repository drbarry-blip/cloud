import "server-only";
import { config } from "../config";
import type { ShopperDeps } from "./deps";

const DAY = 24 * 60 * 60 * 1000;
/** SPEC.md §10.7: Secret Shopper evidence 24 months, voicemail audio 12 months. */
export const EVIDENCE_DAYS = 730;
export const VOICEMAIL_DAYS = 365;

/** Deletes old recordings at Twilio (then our pointer to them) and old evidence. */
export async function applyRetention(deps: ShopperDeps, fetchImpl: typeof fetch = fetch): Promise<{ recordings: number; evidence: number }> {
  const now = deps.now().getTime();
  const twilio = config.twilio();
  let recordings = 0;
  for (const r of await deps.repo.oldRecordings(new Date(now - VOICEMAIL_DAYS * DAY))) {
    if (twilio) {
      const url = new URL(r.recordingUrl);
      if (url.protocol === "https:" && url.hostname === "api.twilio.com") {
        const res = await fetchImpl(`${url.toString().replace(/\.(?:mp3|wav|json)$/, "")}.json`, {
          method: "DELETE",
          headers: { Authorization: `Basic ${Buffer.from(`${twilio.accountSid}:${twilio.authToken}`).toString("base64")}` },
          signal: AbortSignal.timeout(15_000),
        }).catch(() => null);
        // 404 means it's already gone; anything else, try again next time.
        if (!res || (!res.ok && res.status !== 404)) continue;
      }
    }
    await deps.repo.clearRecording(r.id);
    recordings++;
  }
  const evidence = await deps.repo.purgeEvidence(new Date(now - EVIDENCE_DAYS * DAY));
  return { recordings, evidence };
}
