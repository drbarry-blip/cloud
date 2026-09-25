import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// Twilio webhooks: signature checks and TwiML responses. Twilio signs the exact
// public URL it called plus the POSTed form fields, sorted by name.

export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return createHmac("sha1", authToken).update(data).digest("base64");
}

export function validTwilioSignature(authToken: string, url: string, params: Record<string, string>, signature: string | null): boolean {
  if (!signature) return false;
  const expected = Buffer.from(twilioSignature(authToken, url, params));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export function twiml(body = ""): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, { headers: { "Content-Type": "text/xml" } });
}
