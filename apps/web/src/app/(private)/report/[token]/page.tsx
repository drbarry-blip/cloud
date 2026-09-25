import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { CopyButton, PrintButton } from "@/components/CopyButton";
import { formatBusinessMinutes } from "@cgs/core";
import { config } from "@/lib/config";
import { formatDate, formatDateTime } from "@/lib/format";
import { getPlaybook } from "@/lib/playbook";
import { liveShopperDeps } from "@/lib/shopper/deps";
import { reviveReport } from "@/lib/shopper/grade";
import { testDates } from "@/lib/shopper/schedule";
import { verifyToken } from "@/lib/tokens";
import { RevenueCalculator } from "./RevenueCalculator";

export const metadata: Metadata = { title: "Secret Shopper report", robots: { index: false, follow: false } };

const LABELS: Record<string, string> = { personal: "Personal", auto_reply: "Auto-reply", marketing: "Marketing", reminder: "Reminder" };
const CHANNELS: Record<string, string> = { email: "Email", sms: "Text", call: "Call" };
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

function NotFound() {
  return (
    <div className="container narrow">
      <section className="hero">
        <h1>Report not found</h1>
        <p className="lead">This link is incomplete or out of date. Please use the link from your email.</p>
      </section>
    </div>
  );
}

export default async function ReportPage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const testId = verifyToken(decodeURIComponent(token), "report");
  if (!testId) return <NotFound />;
  const { repo } = await liveShopperDeps();
  const test = await repo.getTest(testId);
  const report = test ? reviveReport(test.result) : null;
  if (!test || !report || !["qa", "delivered"].includes(test.status)) return <NotFound />;
  const clinic = (await repo.getClinic(test.clinicId))!;
  const tz = report.clinic.timezone;
  const g = report.grade;
  const playbook = getPlaybook();
  const criteriaText = new Map([...playbook.secretShopperRubric.parts.conversation_quality.criteria, ...playbook.secretShopperRubric.parts.reachability.criteria].map((c) => [c.id, c.description]));
  const observationText = new Map(playbook.secretShopperRubric.observations_not_scored.map((o) => [o.id, o.look_for]));
  const headline = test.headlineOverride ?? g.headline;
  const sentPersonas = g.personas.filter((p) => p.sentAt);
  const atRisk = sentPersonas.filter((p) => p.businessMinutes === null || p.businessMinutes > 8 * 60).length;
  const history = (await repo.deliveredTests(clinic.id)).filter((t) => t.id !== test.id && t.score != null).slice(0, 6);
  const tokenParam = encodeURIComponent(decodeURIComponent(token));
  const personaResult = new Map(g.personas.map((p) => [p.id, p]));
  // Recordings stream from Twilio; without it there's nothing to play.
  const recordingsAvailable = Boolean(config.twilio());

  return (
    <div className="container narrow stack" style={{ paddingTop: 24 }}>
      {test.status === "qa" ? <p className="notice notice-warn no-print">Preview: this report is in review and hasn&apos;t been sent to the customer.</p> : null}

      <section className="card report-hero">
        <div className={`grade-badge grade-${g.grade}`} aria-label={`Grade ${g.grade}`}>
          {g.grade}
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <p className="eyebrow" style={{ margin: 0 }}>
            {test.kind === "retest" ? "Monthly retest" : test.kind === "quarterly" ? "Quarterly test" : "Secret Shopper baseline"} · {testDates(test, clinic)}
          </p>
          <h1 style={{ margin: "4px 0" }}>{report.clinic.name}</h1>
          <p className="lead" style={{ margin: 0 }}>
            <strong>{headline}</strong>
          </p>
          <p className="small muted" style={{ margin: "6px 0 0" }}>
            Score {Math.round(g.total)}/100 · {report.inquiriesDelivered} fictional new-patient inquiries
          </p>
        </div>
        <div className="no-print">
          <PrintButton />
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Scorecard</h2>
        {g.parts.map((p) => (
          <div key={p.id} className="pillar">
            <div className="pillar-head">
              <span>{p.label}</span>
              <span>
                {Math.round(p.points)} / {p.maxPoints}
              </span>
            </div>
            <div className="bar" aria-hidden="true">
              <div style={{ width: `${pct(p.points, p.maxPoints)}%` }} />
            </div>
            {p.note ? <p className="small muted" style={{ margin: "4px 0 0" }}>{p.note}</p> : null}
          </div>
        ))}
        {history.length ? (
          <p className="small muted" style={{ marginBottom: 0 }}>
            Earlier scores: {history.map((t) => `${t.score} (${formatDate(t.deliveredAt, tz)})`).join(" · ")}
          </p>
        ) : null}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Your top fixes</h2>
        <ol style={{ margin: 0, paddingLeft: "1.2em" }}>
          {g.fixes.map((f) => (
            <li key={f.id} style={{ marginBottom: 8 }}>
              {f.text} <span className="small muted">(worth about {Math.round(f.lostPoints)} points)</span>
            </li>
          ))}
        </ol>
        {report.findings.length ? (
          <>
            <h3>Also found</h3>
            <ul style={{ margin: 0 }}>
              {report.findings.map((f, i) => (
                <li key={i}>{f.text}</li>
              ))}
            </ul>
          </>
        ) : null}
        {report.clinic.ownerStandard ? (
          <>
            <h3>Your standard vs. what happened</h3>
            <p style={{ margin: 0 }}>
              <span className="muted">You said:</span> &ldquo;{report.clinic.ownerStandard}&rdquo;
            </p>
            <p style={{ margin: "6px 0 0" }}>
              <span className="muted">What happened:</span>{" "}
              {sentPersonas
                .map((p) => (p.businessMinutes === null ? "no reply from a person" : `first personal reply after ${formatBusinessMinutes(p.businessMinutes)}, ${p.humanTouches} attempt${p.humanTouches === 1 ? "" : "s"}`))
                .join("; ")}
              .
            </p>
          </>
        ) : null}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>What happened, inquiry by inquiry</h2>
        <p className="small muted">Times are in your clinic&apos;s time zone. Response times count business hours only.</p>
        {report.timeline.map((t) => {
          const r = personaResult.get(t.personaId);
          return (
            <div key={t.personaId} style={{ marginTop: 18 }}>
              <h3 style={{ margin: 0 }}>{t.label}</h3>
              <p className="small muted" style={{ margin: "2px 0" }}>
                Asked about {t.serviceName} by {t.channel === "web_form" ? "your website form" : "email"}
                {r && r.sentAt ? ` · ${r.speedBand}${r.businessMinutes !== null ? ` (${formatBusinessMinutes(r.businessMinutes)})` : ""} · ${r.humanTouches} personal attempt${r.humanTouches === 1 ? "" : "s"} over ${r.distinctDays} day${r.distinctDays === 1 ? "" : "s"}` : ""}
              </p>
              <ul className="touches">
                {t.sentAt ? (
                  <li className="persona">
                    <strong>{formatDateTime(t.sentAt, tz)}</strong>: inquiry sent
                    {t.inquiryEvidence.confirmation ? <> (the site said: <span className="quote">&ldquo;{t.inquiryEvidence.confirmation}&rdquo;</span>)</> : null}
                    {t.inquiryEvidence.after ? (
                      <>
                        {" "}
                        · <a href={`/api/report/evidence/${t.inquiryEvidence.after}?t=${tokenParam}`} target="_blank" rel="noopener">screenshot</a>
                      </>
                    ) : null}
                  </li>
                ) : (
                  <li className="persona">Not sent</li>
                )}
                {[...t.touches.map((x) => ({ at: x.at, touch: x, reply: null as null | { at: string; text: string } })), ...t.personaReplies.map((x) => ({ at: x.at, touch: null, reply: x }))]
                  .sort((a, b) => a.at.localeCompare(b.at))
                  .map((row, i) =>
                    row.reply ? (
                      <li key={`r${i}`} className="persona">
                        <strong>{formatDateTime(row.reply.at, tz)}</strong>: the patient replied: <span className="quote">&ldquo;{row.reply.text.replace(/\n+\S+$/, "").trim()}&rdquo;</span>
                      </li>
                    ) : (
                      <li key={row.touch!.id}>
                        <strong>{formatDateTime(row.touch!.at, tz)}</strong>: {CHANNELS[row.touch!.channel]}
                        {row.touch!.voicemail ? " with voicemail" : row.touch!.channel === "call" ? " (no voicemail)" : ""} · {LABELS[row.touch!.label]}
                        {row.touch!.late ? " · after the 10-day window (not scored)" : ""}
                        {row.touch!.text ? <div className="message-box small" style={{ marginTop: 6 }}>{row.touch!.text}</div> : null}
                        {row.touch!.withheld ? <div className="small muted">Content withheld for privacy.</div> : null}
                        {row.touch!.hasRecording && recordingsAvailable ? (
                          <audio controls preload="none" src={`/api/report/recording/${row.touch!.id}?t=${tokenParam}`} style={{ display: "block", marginTop: 6, maxWidth: "100%" }}>
                            Voicemail recording
                          </audio>
                        ) : null}
                      </li>
                    ),
                  )}
                {t.sentAt && t.touches.length === 0 ? <li className="persona">No response of any kind.</li> : null}
              </ul>
            </div>
          );
        })}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Evidence</h2>
        {g.criteria
          .filter((c) => c.applicable)
          .map((c) => (
            <details key={c.id} style={{ marginBottom: 8 }}>
              <summary>
                {criteriaText.get(c.id) ?? c.id}: {c.evidence.filter((e) => e.met).length} of {c.evidence.length}
              </summary>
              <ul className="small" style={{ margin: "6px 0 0" }}>
                {c.evidence.map((e, i) => (
                  <li key={i}>{e.met ? <>Yes{e.quote ? <>: <span className="quote">&ldquo;{e.quote}&rdquo;</span></> : null}</> : "Not seen"}</li>
                ))}
              </ul>
            </details>
          ))}
        {g.observations.length ? (
          <>
            <h3>Worth a look (not scored)</h3>
            <ul className="small" style={{ margin: 0 }}>
              {g.observations.map((o, i) => (
                <li key={i}>
                  {observationText.get(o.id) ?? o.id}: <span className="quote">&ldquo;{o.quote}&rdquo;</span>
                </li>
              ))}
            </ul>
            <p className="small muted">These are observations, not legal conclusions.</p>
          </>
        ) : null}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Your fix-it kit</h2>
        <p className="muted">Scripts written for {report.clinic.name}. Fill in anything in [brackets].</p>
        {report.fixIt.scripts.map((s) => (
          <div key={s.id} style={{ marginBottom: 14 }}>
            <div className="pillar-head">
              <strong>{s.label}</strong>
              <CopyButton text={s.text} />
            </div>
            <div className="message-box">{s.text}</div>
          </div>
        ))}
        <h3>A 10-day follow-up cadence</h3>
        <ul style={{ margin: 0 }}>
          {report.fixIt.cadence.map((c, i) => (
            <li key={`${c.day}-${i}`}>
              <strong>Day {c.day}{c.when ? ` (${c.when})` : ""}:</strong> {c.actions.join("; ")}
            </li>
          ))}
        </ul>
        <h3>Front-desk tips</h3>
        <ul style={{ margin: 0 }}>
          {report.fixIt.tips.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>What slow follow-up may be costing you</h2>
        <RevenueCalculator atRiskShare={sentPersonas.length ? atRisk / sentPersonas.length : 0} />
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Cleanup list</h2>
        <p>These fictional people aren&apos;t real patients. Please delete them from your lead tracker, inbox, and patient system.</p>
        <ul style={{ margin: 0 }}>
          {report.cleanup.map((c) => (
            <li key={c.email}>
              {c.name} · {c.email}
              {c.phone ? ` · ${c.phone.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3")}` : ""}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>A note on coaching</h2>
        <p style={{ margin: 0 }}>
          Results are grouped by channel and time, not by who was working. Use them to train and to fix the process, not to single anyone out. Most slow
          follow-up is a system problem: who owns new leads, how they&apos;re alerted, and what they&apos;re expected to do next.
        </p>
      </section>

      <section className="card no-print">
        <h2 style={{ marginTop: 0 }}>Next steps</h2>
        <p>Make the fixes, then see whether they stick. Monthly Retests send two new inquiries every month, track your score, and alert you if it drops.</p>
        <Link className="btn btn-primary" href="/account">
          Add Monthly Retests
        </Link>
      </section>

      <p className="small muted">
        Graded {formatDate(report.generatedAt, tz)} with playbook {report.playbookVersion}
        {g.method !== "ai" ? " (reviewed by our team)" : ""}.
      </p>
    </div>
  );
}
