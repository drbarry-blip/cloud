import "server-only";
import { NextResponse } from "next/server";
import type { z } from "zod";

export function json<T>(body: T, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function error(status: number, message: string, extra: Record<string, unknown> = {}): NextResponse {
  return json({ error: message, ...extra }, status);
}

/**
 * Client IP for rate limiting. Clients can put anything at the front of X-Forwarded-For,
 * so we count from the end: each trusted proxy appends the address it saw. Cloud Run
 * alone appends one entry (TRUSTED_PROXY_COUNT=1, the default); behind a Google load
 * balancer there are two.
 */
export function clientIp(request: Request, trustedProxies = Number(process.env.TRUSTED_PROXY_COUNT ?? 1)): string {
  const entries = (request.headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const hops = Number.isFinite(trustedProxies) && trustedProxies >= 1 ? Math.floor(trustedProxies) : 1;
  return entries[entries.length - hops] ?? entries[0] ?? request.headers.get("x-real-ip") ?? "unknown";
}

/** Parses a JSON body against a schema. Never logs the body. */
export async function parseBody<S extends z.ZodType>(request: Request, schema: S, maxBytes = 20_000): Promise<{ data: z.infer<S> } | { response: NextResponse }> {
  const text = await request.text();
  if (text.length > maxBytes) return { response: error(413, "That's too long. Please shorten it and try again.") };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { response: error(400, "Invalid request.") };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { response: error(400, first?.message ?? "Invalid request.", { field: first?.path.join(".") }) };
  }
  return { data: parsed.data };
}

export const today = (now = new Date()) => now.toISOString().slice(0, 10);
