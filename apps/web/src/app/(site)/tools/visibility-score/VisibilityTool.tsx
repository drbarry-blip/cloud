"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmailCapture } from "@/components/EmailCapture";
import { postJson } from "@/components/lead-token";
import { Turnstile } from "@/components/Turnstile";

interface PlaceOption {
  id: string;
  name: string;
  address: string;
}
interface Signal {
  id: string;
  label: string;
  points: number;
  maxPoints: number;
  measured: boolean;
  detail: string;
}
interface Pillar {
  id: string;
  label: string;
  score: number;
  maxPoints: number;
  measured: boolean;
  signals: Signal[];
}
interface Report {
  clinic: { name: string; address: string; mapsUri: string | null };
  clinicType: { id: string; name: string };
  result: { total: number; pillars: Pillar[]; quickWins: { signalId: string; text: string }[] };
  competitors: { name: string; rating: number | null; reviewCount: number; distanceMiles: number | null }[];
  website: { status: string; note: string | null; bookingTools: string[]; chatWidgets: string[] };
}

const STEPS = ["Reading your Google profile", "Finding nearby competitors", "Checking your website", "Testing mobile speed (this can take 30 seconds)"];

function scoreColor(total: number) {
  if (total >= 75) return { background: "var(--ok-soft)", color: "var(--ok)" };
  if (total >= 50) return { background: "var(--warn-soft)", color: "var(--warn)" };
  return { background: "var(--danger-soft)", color: "var(--danger)" };
}

export function VisibilityTool({ clinicTypes, turnstileSiteKey, enabled }: { clinicTypes: { id: string; name: string }[]; turnstileSiteKey: string | null; enabled: boolean }) {
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<PlaceOption[] | null>(null);
  const [place, setPlace] = useState<PlaceOption | null>(null);
  const [clinicType, setClinicType] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [resetSignal, setResetSignal] = useState(0);
  const [busy, setBusy] = useState<"search" | "score" | null>(null);
  const [step, setStep] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<{ scanId: string; report: Report } | null>(null);

  useEffect(() => {
    if (busy !== "score") return;
    setStep(0);
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 4000);
    return () => clearInterval(t);
  }, [busy]);

  if (!enabled) {
    return <p className="notice notice-warn">The Visibility Score isn&apos;t switched on yet. Please check back soon.</p>;
  }

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setBusy("search");
    setErrorMessage(null);
    setPlace(null);
    const res = await postJson<{ places: PlaceOption[] }>("/api/places/search", { query });
    setBusy(null);
    if (!res.ok) return setErrorMessage(res.message);
    setPlaces(res.data.places);
  }

  async function score(e: React.FormEvent) {
    e.preventDefault();
    if (!place || !clinicType) return;
    setBusy("score");
    setErrorMessage(null);
    const res = await postJson<{ scanId: string; report: Report }>("/api/visibility-score", { placeId: place.id, clinicType, turnstileToken: token ?? undefined });
    setBusy(null);
    setResetSignal((n) => n + 1);
    if (!res.ok) return setErrorMessage(res.message);
    setResult(res.data);
  }

  if (result) {
    const { report } = result;
    const colors = scoreColor(report.result.total);
    return (
      <div className="stack" aria-live="polite">
        <div className="card score-hero">
          <div className="score-dial" style={colors} aria-label={`Score ${report.result.total} out of 100`}>
            <div>
              {report.result.total}
              <span>/ 100</span>
            </div>
          </div>
          <div>
            <h2 style={{ marginTop: 0 }}>{report.clinic.name}</h2>
            <p className="muted" style={{ margin: 0 }}>{report.clinic.address}</p>
            <p className="small muted" style={{ margin: 0 }}>Compared with nearby {report.clinicType.name.toLowerCase()} clinics</p>
          </div>
        </div>

        {report.result.quickWins.length > 0 ? (
          <div className="card">
            <h3>Your top quick wins</h3>
            <ol style={{ margin: 0, paddingLeft: "1.2em" }}>
              {report.result.quickWins.map((w) => (
                <li key={w.signalId} style={{ marginBottom: 6 }}>{w.text}</li>
              ))}
            </ol>
          </div>
        ) : null}

        <div className="card">
          <h3>Score breakdown</h3>
          {report.result.pillars.map((p) => (
            <div key={p.id} className="pillar">
              <div className="pillar-head">
                <span>{p.label}</span>
                <span>{p.measured ? `${Math.round(p.score)} / ${p.maxPoints}` : "Not measured"}</span>
              </div>
              <div className="bar" aria-hidden="true">
                <div style={{ width: `${p.measured ? (p.score / p.maxPoints) * 100 : 0}%` }} />
              </div>
              <details style={{ marginTop: 6 }}>
                <summary className="small">Details</summary>
                <ul className="small" style={{ margin: "6px 0 0", paddingLeft: "1.2em" }}>
                  {p.signals.map((s) => (
                    <li key={s.id}>
                      <strong>{s.label}:</strong> {s.detail} {s.measured ? `(${s.points}/${s.maxPoints})` : "(not counted)"}
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          ))}
          {report.website.note ? <p className="small muted" style={{ marginTop: 12 }}>{report.website.note}</p> : null}
        </div>

        {report.competitors.length > 0 ? (
          <div className="card">
            <h3>Nearby competitors</h3>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr><th>Clinic</th><th>Rating</th><th>Reviews</th><th>Distance</th></tr>
                </thead>
                <tbody>
                  {report.competitors.map((c, i) => (
                    <tr key={i}>
                      <td>{c.name}</td>
                      <td>{c.rating?.toFixed(1) ?? "–"}</td>
                      <td>{c.reviewCount}</td>
                      <td>{c.distanceMiles === null ? "–" : `${c.distanceMiles} mi`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="small muted" style={{ marginTop: 8 }}>Ratings and review counts from Google Maps.</p>
          </div>
        ) : null}

        <EmailCapture
          source="visibility_score"
          scanId={result.scanId}
          heading="Email me my results"
          description="We'll send your score and quick wins so you can share them with your team."
          buttonLabel="Send my results"
        />
        <div className="card">
          <h3>Do these leads actually turn into patients?</h3>
          <p>Your online presence brings people in. What happens when they contact your front desk decides whether they book.</p>
          <Link className="btn btn-secondary" href="/secret-shopper">See the Secret Shopper</Link>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => { setResult(null); setPlaces(null); setPlace(null); }}>
          Check another clinic
        </button>
      </div>
    );
  }

  return (
    <div className="stack">
      <form className="card stack" onSubmit={search}>
        <div className="field">
          <label htmlFor="q">Your clinic&apos;s name and city</label>
          <input id="q" type="search" required minLength={3} maxLength={120} placeholder="e.g. Glow Med Spa, Austin TX" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div>
          <button className="btn btn-secondary" type="submit" disabled={busy !== null || query.trim().length < 3}>
            {busy === "search" ? "Searching…" : "Find my clinic"}
          </button>
        </div>
      </form>

      {places ? (
        places.length === 0 ? (
          <p className="notice">No matches. Try adding the city or street.</p>
        ) : (
          <form className="card stack" onSubmit={score}>
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend style={{ fontWeight: 600, marginBottom: 8 }}>Which one is yours?</legend>
              {places.map((p) => (
                <label key={p.id} className="checkbox" style={{ marginBottom: 8 }}>
                  <input type="radio" name="place" checked={place?.id === p.id} onChange={() => setPlace(p)} />
                  <span>
                    {p.name}
                    <br />
                    <span className="small muted">{p.address}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="field">
              <label htmlFor="type">Clinic type</label>
              <select id="type" required value={clinicType} onChange={(e) => setClinicType(e.target.value)}>
                <option value="" disabled>Choose one</option>
                {clinicTypes.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <Turnstile siteKey={turnstileSiteKey} onToken={setToken} resetSignal={resetSignal} />
            <div>
              <button className="btn btn-primary" type="submit" disabled={busy !== null || !place || !clinicType || (Boolean(turnstileSiteKey) && !token)}>
                {busy === "score" ? "Scoring…" : "Get my free score"}
              </button>
            </div>
            {busy === "score" ? (
              <ul className="progress-list" aria-live="polite">
                {STEPS.map((s, i) => (
                  <li key={s} className={i < step ? "done" : i === step ? "active" : ""}>{i < step ? "✓ " : ""}{s}</li>
                ))}
              </ul>
            ) : null}
          </form>
        )
      ) : null}
      {errorMessage ? <p className="error-text" role="alert">{errorMessage}</p> : null}
    </div>
  );
}
