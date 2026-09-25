import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config";

// Signed, expiring tokens for email links and for unlocking rewrites.
// Format: base64url(purpose.subject.expiresAtSeconds).base64url(hmac)

export type TokenPurpose = "confirm" | "unsubscribe" | "lead";

const DAY = 24 * 60 * 60;
const DEFAULT_TTL: Record<TokenPurpose, number> = {
  confirm: 14 * DAY,
  unsubscribe: 3650 * DAY, // unsubscribe links must keep working
  lead: 90 * DAY,
};

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createToken(purpose: TokenPurpose, subject: string, nowMs = Date.now(), secret = config.appSecret()): string {
  if (subject.includes(".")) throw new Error("token subject must not contain '.'");
  const exp = Math.floor(nowMs / 1000) + DEFAULT_TTL[purpose];
  const payload = `${purpose}.${subject}.${exp}`;
  return `${Buffer.from(payload).toString("base64url")}.${sign(payload, secret)}`;
}

/** Returns the subject if the token is valid, unexpired, and for this purpose; otherwise null. */
export function verifyToken(token: string | null | undefined, purpose: TokenPurpose, nowMs = Date.now(), secret?: string): string | null {
  if (!token) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const payload = Buffer.from(encoded, "base64url").toString();
  const expected = Buffer.from(sign(payload, secret ?? config.appSecret()));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const [p, subject, exp] = payload.split(".");
  if (p !== purpose || !subject || !exp) return null;
  if (Number(exp) * 1000 < nowMs) return null;
  return subject;
}
