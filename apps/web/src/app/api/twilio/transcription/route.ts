import { liveShopperDeps } from "@/lib/shopper/deps";
import { recordTranscript } from "@/lib/shopper/inbound";
import { twiml } from "@/lib/twilio";
import { readTwilioWebhook } from "@/lib/twilio-webhook";

/** A voicemail transcript is ready. */
export async function POST(request: Request) {
  const hook = await readTwilioWebhook(request);
  if (hook instanceof Response) return hook;
  const { CallSid, TranscriptionText, TranscriptionStatus } = hook.params;
  if (CallSid && TranscriptionStatus === "completed" && TranscriptionText) {
    await recordTranscript(await liveShopperDeps(), CallSid, TranscriptionText);
  }
  return twiml();
}
