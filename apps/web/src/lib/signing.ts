import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// Timestamped HMAC-SHA256 signatures ("t=<unix seconds>,v1=<hex>" over "<t>.<body>").
// Stripe uses this scheme for its webhooks, and our inbound-email worker signs the
// same way, so one checked implementation covers both.

export function verifyTimestampedSignature(payload: string, header: string | null, secret: string, nowSeconds = Date.now() / 1000, toleranceSeconds = 300): boolean {
  if (!header) return false;
  const pairs = header.split(",").map((p) => {
    const i = p.indexOf("=");
    return [p.slice(0, i).trim(), p.slice(i + 1).trim()] as const;
  });
  const t = pairs.find(([k]) => k === "t")?.[1];
  const signatures = pairs.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || !/^\d+$/.test(t) || signatures.length === 0 || Math.abs(nowSeconds - Number(t)) > toleranceSeconds) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex"));
  return signatures.some((s) => {
    const given = Buffer.from(s);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

export function signTimestampedPayload(payload: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  return `t=${nowSeconds},v1=${createHmac("sha256", secret).update(`${nowSeconds}.${payload}`).digest("hex")}`;
}
