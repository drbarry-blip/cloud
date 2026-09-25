"use client";

import { useState } from "react";
import { postJson } from "@/components/lead-token";

/** Completes a sign-in from an emailed link, then goes to `next`. */
export function VerifyButton({ endpoint, token, next, label }: { endpoint: string; token: string | null; next: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!token) return <p className="error-text">This link is incomplete. Please use the full link from your email.</p>;
  return (
    <div className="stack">
      <button
        className="btn btn-primary"
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const res = await postJson(endpoint, { token });
          if (!res.ok) {
            setBusy(false);
            return setMessage(res.message);
          }
          window.location.assign(next);
        }}
      >
        {busy ? "Signing in…" : label}
      </button>
      {message ? <p className="error-text" role="alert">{message}</p> : null}
    </div>
  );
}
