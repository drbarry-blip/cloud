"use client";

import { useState } from "react";
import { postJson } from "./lead-token";

/**
 * A button that POSTs an email-link token. Confirming and unsubscribing need a
 * click (not a plain page load) so email security scanners that open links
 * can't trigger them by accident.
 */
export function TokenAction({ endpoint, token, buttonLabel, doneMessage }: { endpoint: string; token: string | null; buttonLabel: string; doneMessage: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [message, setMessage] = useState<string | null>(null);

  if (!token) return <p className="error-text">This link is incomplete. Please use the full link from your email.</p>;
  if (state === "done") return <p className="notice" role="status">{doneMessage}</p>;

  return (
    <div className="stack">
      <button
        className="btn btn-primary"
        type="button"
        disabled={state === "busy"}
        onClick={async () => {
          setState("busy");
          const res = await postJson(endpoint, { token });
          if (res.ok) setState("done");
          else {
            setState("idle");
            setMessage(res.message);
          }
        }}
      >
        {state === "busy" ? "One moment…" : buttonLabel}
      </button>
      {message ? <p className="error-text" role="alert">{message}</p> : null}
    </div>
  );
}
