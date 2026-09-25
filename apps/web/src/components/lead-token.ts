"use client";

// The lead token unlocks rewrites and higher limits after someone leaves an email.
// Browser storage can be unavailable (private mode, blocked site data), so every
// access is guarded and the app works without it.

const KEY = "cgs.leadToken";

export function readLeadToken(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function saveLeadToken(token: string) {
  try {
    window.localStorage.setItem(KEY, token);
  } catch {
    /* storage unavailable; the token still works for this page view */
  }
}

export async function postJson<T>(url: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; status: number; message: string; data?: Record<string, unknown> }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, status: res.status, message: typeof data.error === "string" ? data.error : "Something went wrong. Please try again.", data };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, status: 0, message: "We couldn't reach the server. Check your connection and try again." };
  }
}
