import { liveShopperDeps } from "@/lib/shopper/deps";
import { recordSms } from "@/lib/shopper/inbound";
import { twiml } from "@/lib/twilio";
import { readTwilioWebhook } from "@/lib/twilio-webhook";

/** A text to a persona number. Receive-only in v1: no reply is sent. */
export async function POST(request: Request) {
  const hook = await readTwilioWebhook(request);
  if (hook instanceof Response) return hook;
  const { MessageSid, From, To, Body } = hook.params;
  if (MessageSid) await recordSms(await liveShopperDeps(), { sid: MessageSid, from: From ?? "", to: To ?? "", body: Body ?? "" });
  return twiml();
}
