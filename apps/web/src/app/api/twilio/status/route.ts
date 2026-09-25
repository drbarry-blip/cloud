import { liveShopperDeps } from "@/lib/shopper/deps";
import { recordCallDetails } from "@/lib/shopper/inbound";
import { twiml } from "@/lib/twilio";
import { readTwilioWebhook } from "@/lib/twilio-webhook";

/** Call status callback: logs the call's length, including missed calls with no voicemail. */
export async function POST(request: Request) {
  const hook = await readTwilioWebhook(request);
  if (hook instanceof Response) return hook;
  const { CallSid, CallDuration } = hook.params;
  if (CallSid) await recordCallDetails(await liveShopperDeps(), CallSid, { durationSeconds: CallDuration ? Number(CallDuration) : null });
  return twiml();
}
