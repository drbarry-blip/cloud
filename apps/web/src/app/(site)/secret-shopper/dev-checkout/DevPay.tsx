"use client";

import { useState } from "react";
import { postJson } from "@/components/lead-token";

export function DevPay({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="stack">
      <button
        type="button"
        className="btn btn-primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const res = await postJson("/api/shopper/dev-pay", { token });
          if (!res.ok) {
            setBusy(false);
            return setMessage(res.message);
          }
          window.location.assign(`/secret-shopper/order?t=${encodeURIComponent(token)}&paid=1`);
        }}
      >
        {busy ? "Paying…" : "Simulate a successful payment"}
      </button>
      {message ? <p className="error-text" role="alert">{message}</p> : null}
    </div>
  );
}
