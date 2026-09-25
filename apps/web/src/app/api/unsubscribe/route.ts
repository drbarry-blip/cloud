import { error, json } from "@/lib/http";
import { getStore } from "@/lib/store";
import { verifyToken } from "@/lib/tokens";

/**
 * Unsubscribes a lead. Handles both our page's form (JSON body with the token) and
 * email clients' one-click unsubscribe (RFC 8058: POST to the link with the token in the URL).
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  let token = url.searchParams.get("t");
  if (!token && request.headers.get("content-type")?.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
    token = typeof body?.token === "string" ? body.token : null;
  }
  const leadId = verifyToken(token, "unsubscribe");
  if (!leadId) return error(400, "This unsubscribe link is invalid.");
  await (await getStore()).unsubscribeLead(leadId, new Date());
  return json({ ok: true });
}
