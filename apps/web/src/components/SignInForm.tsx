"use client";

import { useState } from "react";
import { postJson } from "./lead-token";

/** Asks for an email address and sends a one-time sign-in link. */
export function SignInForm({ endpoint, hint }: { endpoint: string; hint: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent">("idle");
  const [message, setMessage] = useState<string | null>(null);
  if (state === "sent") return <p className="notice" role="status">If that address has access, a sign-in link is on its way. It expires soon, so use it right away.</p>;
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setState("busy");
        const res = await postJson(endpoint, { email });
        if (!res.ok) {
          setState("idle");
          return setMessage(res.message);
        }
        setState("sent");
      }}
    >
      <div className="field">
        <label htmlFor="signin-email">Email</label>
        <input id="signin-email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
        <p className="hint">{hint}</p>
      </div>
      <div>
        <button className="btn btn-primary" type="submit" disabled={state === "busy"}>
          {state === "busy" ? "Sending…" : "Email me a sign-in link"}
        </button>
      </div>
      {message ? <p className="error-text" role="alert">{message}</p> : null}
    </form>
  );
}
