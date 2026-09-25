"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "@/components/lead-token";

type Action = { action: string; [k: string]: unknown };

export interface TaskActionsProps {
  taskId: string;
  type: string;
  isAdmin: boolean;
  draft?: string;
  personas?: { id: string; label: string }[];
  headline?: string;
}

// Mirrors the server's guardrails so the VA sees problems before sending.
const GIVES_DETAILS = /\b\d{3}[\s.-]?\d{3}[\s.-]?\d{4}\b|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/;
const REVEALS_TEST = /\b(?:secret shopper|mystery shop|test(?:ing)?|grad(?:e|ing)|fictional|persona)\b/i;

export function TaskActions({ taskId, type, isAdmin, draft, personas, headline }: TaskActionsProps) {
  const router = useRouter();
  const [minutes, setMinutes] = useState("");
  const [text, setText] = useState(draft ?? "");
  const [note, setNote] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [assignmentId, setAssignmentId] = useState("");
  const [headlineText, setHeadlineText] = useState(headline ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run(body: Action, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setMessage(null);
    const res = await postJson(`/api/admin/tasks/${taskId}`, { ...body, minutesSpent: minutes ? Number(minutes) : undefined });
    setBusy(false);
    if (!res.ok) return setMessage(res.message);
    router.push(body.action === "regrade" ? `/admin/tasks/${taskId}` : "/admin");
    router.refresh();
  }

  const warnings = type === "approve_reply" ? [GIVES_DETAILS.test(text) && "Remove phone numbers or dates.", REVEALS_TEST.test(text) && "Don't mention testing."].filter(Boolean) : [];
  const btn = (label: string, body: Action, opts: { primary?: boolean; confirm?: string; disabled?: boolean } = {}) => (
    <button type="button" className={`btn ${opts.primary ? "btn-primary" : "btn-secondary"}`} disabled={busy || opts.disabled} onClick={() => run(body, opts.confirm)}>
      {label}
    </button>
  );

  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>Actions</h2>

      {type === "verify_ownership" ? (
        <div className="row" style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {btn("Verified: schedule the test", { action: "verify" }, { primary: true, confirm: "Confirm you're satisfied this buyer owns or manages the clinic." })}
          {isAdmin ? (
            <>
              <input type="text" aria-label="Reason for rejecting" placeholder="Reason (for the record)" value={note} onChange={(e) => setNote(e.target.value)} />
              {btn("Reject and refund", { action: "reject", reason: note }, { confirm: "This cancels the test and refunds the buyer in full.", disabled: note.trim().length < 3 })}
            </>
          ) : (
            <p className="small muted">Can&apos;t verify? Resolve with a note and an admin will decide.</p>
          )}
        </div>
      ) : null}

      {type === "submit_form" ? (
        <div className="stack">
          <div className="field">
            <label htmlFor="conf">Confirmation message shown after submitting</label>
            <input id="conf" type="text" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {btn("I submitted it", { action: "form_submitted", confirmation }, { primary: true })}
            {btn("Retry automatically", { action: "retry" })}
          </div>
          <div className="field">
            <label htmlFor="broken">What went wrong (if the form is broken)</label>
            <input id="broken" type="text" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div>{btn("Form is broken: switch to email", { action: "form_broken", note }, { disabled: note.trim().length < 3 })}</div>
        </div>
      ) : null}

      {type === "fix_failure" ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>{btn("Retry sending", { action: "retry" }, { primary: true, confirm: "Make sure it didn't already go out, so the clinic doesn't get it twice." })}</div>
      ) : null}

      {type === "approve_reply" ? (
        <div className="stack">
          <div className="field">
            <label htmlFor="reply">Reply (sent by email as the persona)</label>
            <textarea id="reply" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} />
          </div>
          {warnings.length ? <p className="error-text">{warnings.join(" ")}</p> : null}
          <div>{btn("Send as the persona", { action: "send_reply", text }, { primary: true, disabled: warnings.length > 0 || text.trim().length < 10 })}</div>
        </div>
      ) : null}

      {type === "match_inbound" ? (
        <div className="stack">
          <div className="field">
            <label htmlFor="persona">Which persona was this for?</label>
            <select id="persona" value={assignmentId} onChange={(e) => setAssignmentId(e.target.value)}>
              <option value="">Choose…</option>
              {(personas ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div>{btn("Match to this persona", { action: "match", assignmentId }, { primary: true, disabled: !assignmentId })}</div>
        </div>
      ) : null}

      {type === "review_phi" && isAdmin ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {btn("It's patient information: delete and notify", { action: "phi_confirmed" }, { primary: true, confirm: "This deletes the message content now and emails the customer a privacy notice." })}
          {btn("False alarm: release", { action: "phi_false_alarm" })}
        </div>
      ) : null}

      {type === "qa_report" ? (
        <div className="stack">
          <div className="field">
            <label htmlFor="headline">
              Headline <span className="hint">(leave as is unless it&apos;s unclear)</span>
            </label>
            <input id="headline" type="text" maxLength={300} value={headlineText} onChange={(e) => setHeadlineText(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="qanotes">QA notes (internal)</label>
            <textarea id="qanotes" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} style={{ minHeight: 80 }} />
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {btn("Approve and send to the customer", { action: "approve_report", headline: headlineText === headline ? null : headlineText, notes: note || null }, { primary: true, confirm: "Send the report to the customer now?" })}
            {btn("Re-grade", { action: "regrade" })}
          </div>
        </div>
      ) : null}

      <div className="field" style={{ marginTop: 8 }}>
        <label htmlFor="minutes">
          Minutes spent <span className="hint">(for cost tracking)</span>
        </label>
        <input id="minutes" type="number" min={0} max={600} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} style={{ maxWidth: 140 }} />
      </div>
      {type !== "review_phi" ? (
        <details>
          <summary className="small">Resolve with a note instead</summary>
          <div className="inline-add" style={{ marginTop: 8 }}>
            <input type="text" aria-label="Resolution note" value={note} onChange={(e) => setNote(e.target.value)} />
            {btn("Resolve", { action: "resolve", note }, { disabled: !note.trim() })}
          </div>
        </details>
      ) : null}
      {message ? (
        <p className="error-text" role="alert">
          {message}
        </p>
      ) : null}
    </div>
  );
}
