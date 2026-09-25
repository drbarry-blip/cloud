"use client";

import { useEffect, useState } from "react";
import { EmailCapture } from "@/components/EmailCapture";
import { postJson, readLeadToken } from "@/components/lead-token";
import { Turnstile } from "@/components/Turnstile";

interface Flag {
  category: string;
  severity: "unsafe" | "caution";
  match: string;
  start: number;
  end: number;
  reason: string;
  source: "rules" | "ai";
}
interface Rewrite {
  id: string;
  label: string;
  text: string;
  source: "ai" | "template";
}
interface Result {
  verdict: "safe" | "needs_changes" | "unsafe";
  flags: Flag[];
  mode: "ai" | "rules_only";
  rewrites: Rewrite[] | null;
  rewritesLocked: boolean;
}

const VERDICT_COPY: Record<Result["verdict"], { title: string; body: string }> = {
  safe: { title: "Looks safe", body: "We didn't find anything that confirms the reviewer is a patient or reveals their care." },
  needs_changes: { title: "Needs changes", body: "Nothing clearly unsafe, but a few things are worth fixing before you post." },
  unsafe: { title: "Don't post this yet", body: "This reply could reveal that the reviewer is a patient or disclose details of their care." },
};

const CATEGORY_LABELS: Record<string, string> = {
  confirms_patient: "Confirms they're a patient",
  treatment_details: "Treatment or condition details",
  identifiers: "Identifying details",
  billing_insurance: "Billing or insurance",
  arguing_care: "Arguing about their care",
  tone: "Tone",
  no_private_path: "No way to talk privately",
};

/** Splits the reply into plain and highlighted segments; overlapping flags merge, keeping the worst severity. */
function segments(text: string, flags: Flag[]) {
  const spans = flags.filter((f) => f.end > f.start).sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number; severity: Flag["severity"]; reasons: string[] }[] = [];
  for (const f of spans) {
    const last = merged[merged.length - 1];
    if (last && f.start < last.end) {
      last.end = Math.max(last.end, f.end);
      if (f.severity === "unsafe") last.severity = "unsafe";
      last.reasons.push(f.reason);
    } else {
      merged.push({ start: f.start, end: f.end, severity: f.severity, reasons: [f.reason] });
    }
  }
  const out: { text: string; mark?: { severity: Flag["severity"]; reason: string } }[] = [];
  let pos = 0;
  for (const m of merged) {
    if (m.start > pos) out.push({ text: text.slice(pos, m.start) });
    out.push({ text: text.slice(m.start, m.end), mark: { severity: m.severity, reason: [...new Set(m.reasons)].join(" ") } });
    pos = m.end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos) });
  return out;
}

export function ReplyChecker({ clinicTypes, turnstileSiteKey }: { clinicTypes: { id: string; name: string }[]; turnstileSiteKey: string | null }) {
  const [review, setReview] = useState("");
  const [reply, setReply] = useState("");
  const [clinicType, setClinicType] = useState("");
  const [role, setRole] = useState("");
  const [phone, setPhone] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [resetSignal, setResetSignal] = useState(0);
  const [leadToken, setLeadToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [needsEmail, setNeedsEmail] = useState(false);
  const [result, setResult] = useState<{ checkedText: string; data: Result } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => setLeadToken(readLeadToken()), []);

  async function check(withLeadToken = leadToken) {
    setBusy(true);
    setErrorMessage(null);
    const checkedText = reply.trim();
    const res = await postJson<Result>("/api/reply-check", {
      reply: checkedText,
      review: review.trim() || undefined,
      clinicType: clinicType || undefined,
      contactRole: role.trim() || undefined,
      contactPhone: phone.trim() || undefined,
      leadToken: withLeadToken ?? undefined,
      turnstileToken: token ?? undefined,
    });
    setBusy(false);
    setResetSignal((n) => n + 1);
    if (!res.ok) {
      setErrorMessage(res.message);
      setNeedsEmail(res.data?.needsEmail === true);
      return;
    }
    setNeedsEmail(false);
    setResult({ checkedText, data: res.data });
  }

  async function copy(r: Rewrite) {
    try {
      await navigator.clipboard.writeText(r.text);
      setCopied(r.id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* clipboard unavailable; the text is selectable */
    }
  }

  const waitingForHumanCheck = Boolean(turnstileSiteKey) && !token;

  return (
    <div className="stack">
      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault();
          void check();
        }}
      >
        <div className="field">
          <label htmlFor="review">
            The review <span className="hint">(optional, helps us suggest a better reply)</span>
          </label>
          <textarea id="review" value={review} onChange={(e) => setReview(e.target.value)} maxLength={5000} rows={4} />
        </div>
        <div className="field">
          <label htmlFor="reply">Your draft reply</label>
          <textarea id="reply" required value={reply} onChange={(e) => setReply(e.target.value)} maxLength={3000} rows={6} />
        </div>
        <div className="field">
          <label htmlFor="clinic-type">
            Clinic type <span className="hint">(optional)</span>
          </label>
          <select id="clinic-type" value={clinicType} onChange={(e) => setClinicType(e.target.value)}>
            <option value="">Not specified</option>
            {clinicTypes.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <details>
          <summary>Contact details for rewrites (optional)</summary>
          <div className="grid grid-2" style={{ marginTop: 12 }}>
            <div>
              <label htmlFor="role">Who should reviewers ask for?</label>
              <input id="role" type="text" placeholder="our office manager" value={role} onChange={(e) => setRole(e.target.value)} maxLength={60} />
            </div>
            <div>
              <label htmlFor="phone">Office phone</label>
              <input id="phone" type="tel" placeholder="(555) 555-0100" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} />
            </div>
          </div>
        </details>
        <Turnstile siteKey={turnstileSiteKey} onToken={setToken} resetSignal={resetSignal} />
        {errorMessage ? <p className="error-text" role="alert">{errorMessage}</p> : null}
        <div>
          <button className="btn btn-primary" type="submit" disabled={busy || reply.trim().length < 10 || waitingForHumanCheck}>
            {busy ? "Checking…" : "Check my reply"}
          </button>
        </div>
      </form>

      {needsEmail && !leadToken ? (
        <EmailCapture
          source="reply_checker"
          heading="Unlock more checks"
          description="Leave your email to get more checks per day, plus safe rewrites of your reply."
          buttonLabel="Unlock"
          onSuccess={(t) => {
            setLeadToken(t);
            setNeedsEmail(false);
            setErrorMessage(null);
          }}
        />
      ) : null}

      {result ? (
        <section aria-live="polite" className="stack">
          <div className={`verdict verdict-${result.data.verdict}`}>
            <h2>{VERDICT_COPY[result.data.verdict].title}</h2>
            <p style={{ margin: 0 }}>{VERDICT_COPY[result.data.verdict].body}</p>
          </div>
          {result.data.flags.length > 0 ? (
            <div className="card stack">
              <h3>What we flagged</h3>
              <div className="highlighted">
                {segments(result.checkedText, result.data.flags).map((s, i) =>
                  s.mark ? (
                    <mark key={i} className={s.mark.severity} title={s.mark.reason}>{s.text}</mark>
                  ) : (
                    <span key={i}>{s.text}</span>
                  ),
                )}
              </div>
              <ul className="flag-list">
                {result.data.flags.map((f, i) => (
                  <li key={i}>
                    <span className={`badge badge-${f.severity}`}>{f.severity === "unsafe" ? "Unsafe" : "Caution"}</span>{" "}
                    {f.match ? <><span className="quote">&ldquo;{f.match}&rdquo;</span> · </> : null}
                    {CATEGORY_LABELS[f.category] ?? f.category}
                    <div className="small muted">{f.reason}</div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {result.data.mode === "rules_only" ? (
            <p className="small muted">Checked with our rules only; AI review is unavailable right now, so subtle issues may be missed.</p>
          ) : null}

          {result.data.rewritesLocked ? (
            leadToken ? (
              <div className="card row">
                <p style={{ margin: 0 }}>Your email is saved. Get safe rewrites of this reply:</p>
                <button className="btn btn-secondary" type="button" disabled={busy || waitingForHumanCheck} onClick={() => void check(leadToken)}>
                  Show rewrites
                </button>
              </div>
            ) : (
              <EmailCapture
                source="reply_checker"
                heading="Get safe rewrites"
                description="Enter your email to see safe versions of your reply. Rewrites are shown here, not emailed."
                buttonLabel="Unlock rewrites"
                onSuccess={(t) => setLeadToken(t)}
              />
            )
          ) : result.data.rewrites && result.data.rewrites.length > 0 ? (
            <div className="stack">
              <h2 style={{ marginTop: 8 }}>Safe rewrites</h2>
              {result.data.rewrites.map((r) => (
                <div key={r.id} className="card stack">
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <strong>{r.label}</strong>
                    <button type="button" className="btn btn-secondary btn-small" onClick={() => void copy(r)}>
                      {copied === r.id ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <p className="template" style={{ margin: 0 }}>{r.text}</p>
                </div>
              ))}
              <p className="small muted">Every rewrite is re-checked against the same rules before it&apos;s shown.</p>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
