import "server-only";
import { randomBytes } from "node:crypto";

// All settings come from environment variables (see .env.example). Every
// integration is optional in development so the app runs with no accounts:
// missing keys switch that feature to a safe local fallback and log a warning.

const warned = new Set<string>();
function warnOnce(key: string, message: string) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[config] ${message}`);
}

const env = (name: string): string | undefined => {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
};

const isProduction = () => process.env.NODE_ENV === "production";

let devSecret: string | undefined;

export const config = {
  isProduction,
  siteUrl: () => env("SITE_URL") ?? "http://localhost:3000",
  mailingAddress: () => {
    const v = env("MAILING_ADDRESS");
    if (!v) warnOnce("MAILING_ADDRESS", "MAILING_ADDRESS is not set; marketing email needs a postal address (CAN-SPAM).");
    return v ?? "[Postal address not configured]";
  },
  /** Secret for signing email links. A random per-process value is used in development. */
  appSecret: () => {
    const v = env("APP_SECRET");
    if (v) return v;
    if (isProduction()) throw new Error("APP_SECRET must be set in production");
    devSecret ??= randomBytes(32).toString("hex");
    return devSecret;
  },
  /** Claude is used only when both a credential and a model are configured. */
  ai: () => {
    const hasCredential = Boolean(env("ANTHROPIC_API_KEY") ?? env("ANTHROPIC_AUTH_TOKEN"));
    const model = env("ANTHROPIC_MODEL");
    if (!hasCredential || !model) {
      warnOnce("ai", "Claude is not configured (ANTHROPIC_API_KEY and ANTHROPIC_MODEL); the Reply Checker runs rules-only.");
      return null;
    }
    const effort = env("ANTHROPIC_EFFORT") as "low" | "medium" | "high" | undefined;
    return { model, effort };
  },
  googleMapsKey: () => env("GOOGLE_MAPS_API_KEY"),
  pagespeedKey: () => env("PAGESPEED_API_KEY") ?? env("GOOGLE_MAPS_API_KEY"),
  turnstile: () => {
    const siteKey = env("TURNSTILE_SITE_KEY");
    const secretKey = env("TURNSTILE_SECRET_KEY");
    if (!siteKey || !secretKey) {
      if (isProduction()) warnOnce("turnstile", "Turnstile is not configured; free tools have no bot protection.");
      return null;
    }
    return { siteKey, secretKey };
  },
  databaseUrl: () => {
    const v = env("DATABASE_URL");
    if (!v) warnOnce("db", "DATABASE_URL is not set; using the embedded PGlite database (set PGLITE_DIR to keep data between restarts).");
    return v;
  },
  email: () => {
    const apiKey = env("RESEND_API_KEY");
    const from = env("EMAIL_FROM");
    if (!apiKey || !from) {
      warnOnce("email", "Email is not configured (RESEND_API_KEY and EMAIL_FROM); emails are printed to the console.");
      return null;
    }
    return { apiKey, from, replyTo: env("EMAIL_REPLY_TO") };
  },
  cronSecret: () => env("CRON_SECRET"),
  plausibleDomain: () => env("PLAUSIBLE_DOMAIN"),
  limits: () => ({
    replyChecksPerDayAnonymous: Number(env("LIMIT_REPLY_CHECKS_ANON") ?? 5),
    replyChecksPerDayWithEmail: Number(env("LIMIT_REPLY_CHECKS_EMAIL") ?? 30),
    visibilityScoresPerDayPerIp: Number(env("LIMIT_VISIBILITY_PER_IP") ?? 5),
    visibilityScoresPerDayTotal: Number(env("LIMIT_VISIBILITY_TOTAL") ?? 300),
    leadsPerDayPerIp: Number(env("LIMIT_LEADS_PER_IP") ?? 10),
  }),
};
