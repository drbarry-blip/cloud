import { config } from "@/lib/config";
import { getPlaybook } from "@/lib/playbook";
import { liveShopperDeps } from "@/lib/shopper/deps";
import { recordCallStart } from "@/lib/shopper/inbound";
import { twiml, xmlEscape } from "@/lib/twilio";
import { readTwilioWebhook } from "@/lib/twilio-webhook";

/**
 * A call to a persona number. Calls are never answered live: a short greeting in the
 * persona's name plays, and any voicemail is recorded and transcribed (SPEC.md §7.1).
 */
export async function POST(request: Request) {
  const hook = await readTwilioWebhook(request);
  if (hook instanceof Response) return hook;
  const p = hook.params;
  const { firstName, sex } = await recordCallStart(await liveShopperDeps(), { sid: p.CallSid!, from: p.From ?? "", to: p.To ?? "" });
  const greeting = firstName
    ? getPlaybook().personaRules.identity.voicemail_greeting.replace("{persona_first_name}", firstName)
    : "The person you're calling isn't available. Please leave a message after the tone.";
  const voice = sex === "male" ? "Polly.Matthew-Neural" : "Polly.Joanna-Neural";
  const site = config.siteUrl();
  return twiml(
    `<Say voice="${voice}">${xmlEscape(greeting)}</Say>` +
      `<Record maxLength="120" timeout="5" playBeep="true" trim="trim-silence" recordingStatusCallback="${site}/api/twilio/recording" recordingStatusCallbackEvent="completed" transcribe="true" transcribeCallback="${site}/api/twilio/transcription"/>`,
  );
}
