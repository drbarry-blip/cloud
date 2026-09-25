import { config } from "@/lib/config";
import { error, json } from "@/lib/http";
import { seedDemoTest } from "@/lib/shopper/demo";
import { liveShopperDeps } from "@/lib/shopper/deps";
import { reportUrl } from "@/lib/shopper/report";

/** Development only: runs a complete fictional test so the console and report have data. */
export async function POST() {
  if (config.isProduction()) return error(404, "Not found.");
  const deps = await liveShopperDeps();
  const { testId, orderId } = await seedDemoTest(deps);
  return json({ testId, orderId, report: reportUrl(deps.siteUrl, testId), console: `${deps.siteUrl}/admin/tests/${testId}` });
}
