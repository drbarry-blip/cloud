import "server-only";
import { config } from "./config";
import { validTwilioSignature } from "./twilio";

/**
 * Reads and authenticates a Twilio webhook. Twilio signs the public URL it called,
 * so the check uses SITE_URL rather than the (possibly internal) request URL.
 */
export async function readTwilioWebhook(request: Request): Promise<{ params: Record<string, string> } | Response> {
  const twilio = config.twilio();
  if (!twilio) return new Response("Not found", { status: 404 });
  const form = await request.formData();
  const params = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  const url = new URL(request.url);
  const publicUrl = `${config.siteUrl()}${url.pathname}${url.search}`;
  if (!validTwilioSignature(twilio.authToken, publicUrl, params, request.headers.get("x-twilio-signature"))) {
    return new Response("Bad signature", { status: 403 });
  }
  if (params.AccountSid && params.AccountSid !== twilio.accountSid) return new Response("Wrong account", { status: 403 });
  return { params };
}
