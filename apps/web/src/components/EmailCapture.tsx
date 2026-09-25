"use client";

import { useId, useState } from "react";
import { postJson, saveLeadToken } from "./lead-token";

type Source = "reply_checker" | "visibility_score" | "secret_shopper_waitlist";

export function EmailCapture({
  source,
  scanId,
  heading,
  description,
  buttonLabel,
  consentLabel = "Send me occasional tips on turning more inquiries into patients. Unsubscribe any time.",
  requireConsent = false,
  onSuccess,
}: {
  source: Source;
  scanId?: string;
  heading: string;
  description?: string;
  buttonLabel: string;
  consentLabel?: string;
  /** For the waitlist, joining *is* the consent, so the box is required. */
  requireConsent?: boolean;
  onSuccess?: (leadToken: string, confirmationSent: boolean) => void;
}) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (requireConsent && !consent) {
      setMessage("Please tick the box so we can email you.");
      return;
    }
    setState("sending");
    setMessage(null);
    const res = await postJson<{ leadToken: string; confirmationSent: boolean }>("/api/leads", { email, source, marketingConsent: consent, scanId });
    if (!res.ok) {
      setState("idle");
      setMessage(res.message);
      return;
    }
    saveLeadToken(res.data.leadToken);
    setState("done");
    setMessage(res.data.confirmationSent ? "Check your inbox and click the link to confirm your email." : "Thanks! You're all set.");
    onSuccess?.(res.data.leadToken, res.data.confirmationSent);
  }

  return (
    <form className="card stack" onSubmit={submit} aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`}>{heading}</h3>
      {description ? <p className="muted">{description}</p> : null}
      {state === "done" ? (
        <p role="status" className="notice">{message}</p>
      ) : (
        <>
          <div className="field">
            <label htmlFor={`${id}-email`}>Email</label>
            <input id={`${id}-email`} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <label className="checkbox">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>{consentLabel}</span>
          </label>
          {message ? <p className="error-text" role="alert">{message}</p> : null}
          <div>
            <button className="btn btn-primary" type="submit" disabled={state === "sending"}>
              {state === "sending" ? "Sending…" : buttonLabel}
            </button>
          </div>
        </>
      )}
    </form>
  );
}
