"use client";

import { useState } from "react";
import { postJson } from "@/components/lead-token";

/** Lets the owner get a code sent to the clinic's public email and enter it here. */
export function ClinicCode({ token, publicEmail }: { token: string; publicEmail: string }) {
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);

  async function send() {
    setBusy(true);
    setMessage(null);
    const res = await postJson("/api/shopper/clinic-code", { token, action: "send" });
    setBusy(false);
    if (!res.ok) return setMessage({ kind: "error", text: res.message });
    setSent(true);
    setMessage({ kind: "ok", text: `Code sent to ${publicEmail}. It expires in 48 hours.` });
  }

  async function check(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const res = await postJson("/api/shopper/clinic-code", { token, code });
    if (!res.ok) {
      setBusy(false);
      return setMessage({ kind: "error", text: res.message });
    }
    window.location.reload();
  }

  return (
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>
        We&apos;ll email a six-digit code to <strong>{publicEmail}</strong>. The email mentions our company name but not the test, so whoever reads that
        inbox won&apos;t learn when inquiries arrive.
      </p>
      <div>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={send}>
          {sent ? "Send a new code" : "Email a code to the clinic"}
        </button>
      </div>
      {sent ? (
        <form className="inline-add" onSubmit={check}>
          <label htmlFor="code" className="visually-hidden">
            Verification code
          </label>
          <input id="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          <button className="btn btn-primary" type="submit" disabled={busy || code.length !== 6}>
            Verify
          </button>
        </form>
      ) : null}
      {message ? (
        <p className={message.kind === "error" ? "error-text" : "notice"} role={message.kind === "error" ? "alert" : "status"}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
