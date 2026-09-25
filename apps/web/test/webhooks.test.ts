import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createLiteDb, setDb } from "@/lib/db";
import { signTimestampedPayload } from "@/lib/signing";
import { twilioSignature, validTwilioSignature } from "@/lib/twilio";

describe("twilio signatures", () => {
  // The worked example from Twilio's security documentation.
  const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
  const params = { CallSid: "CA1234567890ABCDE", Caller: "+12349013030", Digits: "1234", From: "+12349013030", To: "+18005551212" };

  it("matches Twilio's documented example", () => {
    expect(twilioSignature("12345", url, params)).toBe("0/KCTR6DLpKmkAf8muzZqo1nDgQ=");
    expect(validTwilioSignature("12345", url, params, "0/KCTR6DLpKmkAf8muzZqo1nDgQ=")).toBe(true);
  });

  it("rejects tampered params, other URLs, and missing signatures", () => {
    expect(validTwilioSignature("12345", url, { ...params, Digits: "9999" }, "0/KCTR6DLpKmkAf8muzZqo1nDgQ=")).toBe(false);
    expect(validTwilioSignature("12345", "https://evil.example/myapp.php?foo=1&bar=2", params, "0/KCTR6DLpKmkAf8muzZqo1nDgQ=")).toBe(false);
    expect(validTwilioSignature("12345", url, params, null)).toBe(false);
  });
});

describe("webhook routes", () => {
  const env = { ...process.env };
  beforeAll(async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    process.env.INBOUND_EMAIL_SECRET = "inbound-secret";
    process.env.TWILIO_ACCOUNT_SID = "AC123";
    process.env.TWILIO_AUTH_TOKEN = "twilio-token";
    process.env.SITE_URL = "https://app.example";
    setDb(await createLiteDb());
  });
  afterAll(() => {
    process.env = env;
    vi.restoreAllMocks();
  });

  it("accepts signed inbound email and rejects anything unsigned", async () => {
    const { POST } = await import("@/app/api/inbound/email/route");
    const body = JSON.stringify({ to: "someone@personas.example.net", from: "clinic@x.example", subject: "Hi", text: "Hello", messageId: "<m1@x>" });
    const post = (headers: Record<string, string>, payload = body) =>
      POST(new Request("https://app.example/api/inbound/email", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: payload }));

    expect((await post({})).status).toBe(401);
    expect((await post({ "x-inbound-signature": signTimestampedPayload(body, "wrong") })).status).toBe(401);
    expect((await post({ "x-inbound-signature": signTimestampedPayload(body, "inbound-secret", Math.floor(Date.now() / 1000) - 3600) })).status).toBe(401);
    const ok = await post({ "x-inbound-signature": signTimestampedPayload(body, "inbound-secret") });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ status: "unmatched" });
    const bad = "{not json";
    expect((await post({ "x-inbound-signature": signTimestampedPayload(bad, "inbound-secret") }, bad)).status).toBe(400);
  });

  it("answers persona calls with a greeting and a recording, only for signed requests", async () => {
    const { POST } = await import("@/app/api/twilio/voice/route");
    const params = { AccountSid: "AC123", CallSid: "CA77", From: "+15125550100", To: "+15125550199" };
    const call = (signature: string) =>
      POST(new Request("https://internal.run.app/api/twilio/voice", { method: "POST", headers: { "x-twilio-signature": signature }, body: new URLSearchParams(params) }));

    expect((await call("nope")).status).toBe(403);
    // Twilio signs the public URL (SITE_URL), not the internal one the app sees.
    const res = await call(twilioSignature("twilio-token", "https://app.example/api/twilio/voice", params));
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("<Say");
    expect(xml).toContain('<Record maxLength="120"');
    expect(xml).toContain('transcribeCallback="https://app.example/api/twilio/transcription"');
  });
});
