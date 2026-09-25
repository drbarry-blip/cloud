import { liveShopperDeps } from "@/lib/shopper/deps";
import { recordCallDetails } from "@/lib/shopper/inbound";
import { twiml } from "@/lib/twilio";
import { readTwilioWebhook } from "@/lib/twilio-webhook";

/** A voicemail recording finished. The audio stays at Twilio; we keep its URL. */
export async function POST(request: Request) {
  const hook = await readTwilioWebhook(request);
  if (hook instanceof Response) return hook;
  const { CallSid, RecordingUrl, RecordingDuration } = hook.params;
  if (CallSid && RecordingUrl) {
    await recordCallDetails(await liveShopperDeps(), CallSid, { recordingUrl: RecordingUrl, recordingSeconds: Number(RecordingDuration ?? 0) });
  }
  return twiml();
}
