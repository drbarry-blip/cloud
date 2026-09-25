import { config } from "@/lib/config";
import { cronAuthError, json } from "@/lib/http";
import { liveShopperDeps } from "@/lib/shopper/deps";
import { runShopperTick } from "@/lib/shopper/engine";

// Form submissions can take a while in a real browser.
export const maxDuration = 300;

/** Runs the Secret Shopper scheduler. Call every 5 minutes with `Authorization: Bearer $CRON_SECRET`. */
export async function POST(request: Request) {
  const denied = cronAuthError(request, config.cronSecret());
  if (denied) return denied;
  const summary = await runShopperTick(await liveShopperDeps());
  if (summary.sent || summary.toVa || summary.closed || summary.rescued) console.info("[shopper] tick", JSON.stringify(summary));
  return json(summary);
}
