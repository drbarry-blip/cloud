"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "./lead-token";

/**
 * A button that POSTs JSON, then refreshes the page (or goes to `redirectTo`, or to a
 * `url` the server returns). `confirm` asks first, for anything hard to undo.
 */
export function ActionButton({
  endpoint,
  body,
  label,
  busyLabel,
  confirm,
  redirectTo,
  variant = "secondary",
}: {
  endpoint: string;
  body: unknown;
  label: string;
  busyLabel?: string;
  confirm?: string;
  redirectTo?: string;
  variant?: "primary" | "secondary";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  return (
    <span className="stack" style={{ display: "inline-block" }}>
      <button
        type="button"
        className={`btn btn-${variant}`}
        disabled={busy}
        onClick={async () => {
          if (confirm && !window.confirm(confirm)) return;
          setBusy(true);
          setMessage(null);
          const res = await postJson<{ url?: string }>(endpoint, body);
          setBusy(false);
          if (!res.ok) return setMessage(res.message);
          if (res.data.url) window.location.assign(res.data.url);
          else if (redirectTo) router.push(redirectTo);
          else router.refresh();
        }}
      >
        {busy ? (busyLabel ?? "Working…") : label}
      </button>
      {message ? (
        <span className="error-text small" role="alert" style={{ display: "block" }}>
          {message}
        </span>
      ) : null}
    </span>
  );
}
