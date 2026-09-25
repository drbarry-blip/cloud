import "server-only";
import { config } from "./config";

/**
 * Verifies a Cloudflare Turnstile token. When Turnstile isn't configured
 * (local development), every request passes.
 */
export async function verifyTurnstile(token: string | undefined, ip: string): Promise<boolean> {
  const turnstile = config.turnstile();
  if (!turnstile) return true;
  if (!token) return false;
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({ secret: turnstile.secretKey, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch (err) {
    console.error("[turnstile] verification failed:", (err as Error).name);
    return false;
  }
}
