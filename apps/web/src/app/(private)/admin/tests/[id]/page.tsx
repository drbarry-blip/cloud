import { classifyTouch } from "@cgs/core";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/ActionButton";
import { requireStaff } from "@/lib/auth";
import { formatDateTime, formatPhone } from "@/lib/format";
import { liveShopperDeps } from "@/lib/shopper/deps";
import { PERSONA_LETTERS, SCRIPT_NAMES } from "@/lib/shopper/grade";
import { reportUrl } from "@/lib/shopper/report";
import { testDates } from "@/lib/shopper/schedule";
import { TASK_INFO } from "../../task-info";
import { LabelSelect } from "./LabelSelect";

export const metadata = { title: "Test" };

export default async function TestPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { repo } = await liveShopperDeps();
  const test = await repo.getTest(id);
  if (!test) notFound();
  const clinic = (await repo.getClinic(test.clinicId))!;
  const tz = clinic.timezone;
  const personas = await repo.assignmentsForTest(id);
  const events = await repo.inboundForTest(id);
  const outbound = await repo.outboundForTest(id);
  const tasks = (await repo.tasksForTest(id)).filter((t) => staff.role === "admin" || t.type !== "review_phi");
  const audit = staff.role === "admin" ? await repo.auditFor("test", id) : [];
  const isAdmin = staff.role === "admin";
  const endpoint = `/api/admin/tests/${id}`;

  return (
    <div className="stack">
      <p className="small" style={{ margin: 0 }}>
        <Link href="/admin/tests">← Tests</Link>
      </p>
      <h1 style={{ margin: 0 }}>{clinic.name}</h1>
      <p className="small muted" style={{ margin: 0 }}>
        {test.kind} · <span className="pill">{test.status.replace(/_/g, " ")}</span> {test.statusNote ? `· ${test.statusNote}` : ""} · {testDates(test, clinic) ?? "not scheduled"}
        {test.grade ? ` · Grade ${test.grade} (${test.score})` : ""}
      </p>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Clinic</h2>
        <dl className="kv">
          <dt>Type</dt>
          <dd>{clinic.clinicType}</dd>
          <dt>Services</dt>
          <dd>{clinic.services.join(", ")}</dd>
          <dt>Time zone</dt>
          <dd>{tz}</dd>
          <dt>Hours</dt>
          <dd>{Object.entries(clinic.hours).map(([d, h]) => `${d} ${h ? `${h.open}–${h.close}` : "closed"}`).join(" · ")}</dd>
          <dt>Closures</dt>
          <dd>{clinic.blackoutDates.join(", ") || "–"}</dd>
          <dt>Forms</dt>
          <dd>{clinic.formUrls.join(", ") || "–"}</dd>
          <dt>Public email</dt>
          <dd>{clinic.publicEmail ?? "–"}</dd>
          <dt>Verification</dt>
          <dd>{clinic.verificationStatus}{clinic.verificationMethod ? ` (${clinic.verificationMethod})` : ""}</dd>
          <dt>Owner&apos;s standard</dt>
          <dd>{clinic.ownerStandard ?? "–"}</dd>
        </dl>
      </div>

      {test.findings.length ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Findings</h2>
          <ul style={{ margin: 0 }}>
            {test.findings.map((f, i) => (
              <li key={i}>{f.text}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {personas.map((p, i) => {
        const rows = [
          ...outbound.filter((o) => o.assignmentId === p.id).map((o) => ({ at: o.sentAt, out: o, ev: null })),
          ...events.filter((e) => e.assignmentId === p.id).map((e) => ({ at: e.receivedAt, out: null, ev: e })),
        ].sort((a, b) => a.at.getTime() - b.at.getTime());
        return (
          <div className="card" key={p.id}>
            <h2 style={{ marginTop: 0 }}>
              Persona {PERSONA_LETTERS[i]}: {SCRIPT_NAMES[p.script]}
            </h2>
            <dl className="kv">
              <dt>Name</dt>
              <dd>{p.firstName} {p.lastName} ({p.sex})</dd>
              <dt>Email</dt>
              <dd>{p.email}</dd>
              <dt>Phone</dt>
              <dd>{formatPhone(p.phoneNumber)}</dd>
              <dt>Service</dt>
              <dd>{p.serviceName}</dd>
              <dt>Channel</dt>
              <dd>{p.channel === "web_form" ? "Web form" : "Email"} → {p.target}</dd>
              <dt>Scheduled</dt>
              <dd>{formatDateTime(p.scheduledAt, tz)}</dd>
              <dt>Status</dt>
              <dd>{p.sendStatus}{p.sentAt ? `, sent ${formatDateTime(p.sentAt, tz)}` : ""}</dd>
              <dt>Window ends</dt>
              <dd>{formatDateTime(p.observeUntil, tz)} (late until {formatDateTime(p.lateUntil, tz)})</dd>
            </dl>
            <ul className="events" style={{ marginTop: 12 }}>
              {rows.map((r) =>
                r.out ? (
                  <li key={r.out.id}>
                    <div className="meta">
                      <strong>{formatDateTime(r.out.sentAt, tz)}</strong>
                      <span className="pill">{r.out.kind === "inquiry" ? "Inquiry" : "Persona reply"}</span>
                      <span className="muted">{r.out.channel} · {r.out.sentBy}</span>
                      {typeof r.out.evidence.form_before === "string" ? <a href={`/api/admin/evidence/${r.out.evidence.form_before}`} target="_blank" rel="noopener">before</a> : null}
                      {typeof r.out.evidence.form_after === "string" ? <a href={`/api/admin/evidence/${r.out.evidence.form_after}`} target="_blank" rel="noopener">after</a> : null}
                    </div>
                    <div className="message-box" style={{ marginTop: 6 }}>{r.out.body}</div>
                  </li>
                ) : (
                  <li key={r.ev!.id}>
                    <div className="meta">
                      <strong>{formatDateTime(r.ev!.receivedAt, tz)}</strong>
                      <span className="pill pill-ok">{r.ev!.channel}{r.ev!.voicemail ? " + voicemail" : ""}</span>
                      {r.ev!.late ? <span className="pill pill-warn">late</span> : null}
                      {r.ev!.phiQuarantined ? <span className="pill pill-bad">withheld</span> : null}
                      <LabelSelect
                        eventId={r.ev!.id}
                        label={r.ev!.label ?? classifyTouch({ channel: r.ev!.channel, text: r.ev!.body ?? undefined, subject: r.ev!.subject ?? undefined, headers: r.ev!.headers })}
                      />
                      <span className="muted">{r.ev!.fromAddr}</span>
                      {r.ev!.durationSeconds != null ? <span className="muted">{r.ev!.durationSeconds}s</span> : null}
                    </div>
                    {r.ev!.phiQuarantined && !isAdmin ? null : r.ev!.body ? <div className="message-box" style={{ marginTop: 6 }}>{r.ev!.body}</div> : null}
                  </li>
                ),
              )}
              {rows.length === 0 ? <li className="muted">Nothing yet.</li> : null}
            </ul>
          </div>
        );
      })}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Tasks</h2>
        <ul className="task-list">
          {tasks.map((t) => (
            <li key={t.id}>
              <Link href={`/admin/tasks/${t.id}`}>{t.title}</Link>
              <span className="small muted">
                {TASK_INFO[t.type].label} · {t.status}
                {t.minutesSpent != null ? ` · ${t.minutesSpent} min` : ""}
              </span>
            </li>
          ))}
          {tasks.length === 0 ? <li className="muted">None.</li> : null}
        </ul>
      </div>

      <div className="card stack">
        <h2 style={{ margin: 0 }}>Actions</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {test.result ? (
            <a className="btn btn-secondary" href={reportUrl("", test.id)} target="_blank" rel="noopener">
              Open the report
            </a>
          ) : null}
          {isAdmin && ["grading", "qa", "delivered"].includes(test.status) ? <ActionButton endpoint={endpoint} body={{ action: "regrade" }} label="Re-grade" /> : null}
          {isAdmin && test.status === "awaiting_verification" && clinic.verificationStatus === "verified" ? <ActionButton endpoint={endpoint} body={{ action: "schedule" }} label="Try scheduling again" /> : null}
          {isAdmin && ["awaiting_payment", "awaiting_verification", "scheduled", "running"].includes(test.status) ? (
            <>
              <ActionButton endpoint={endpoint} body={{ action: "cancel", refund: "none" }} label="Cancel (no refund)" confirm="Cancel this test? Unsent inquiries stop; anything already sent is graded into a partial report." />
              <ActionButton endpoint={endpoint} body={{ action: "cancel", refund: "full" }} label="Cancel and refund in full" confirm="Cancel this test and refund the customer in full?" />
            </>
          ) : null}
        </div>
      </div>

      {audit.length ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Audit log</h2>
          <ul className="small" style={{ margin: 0 }}>
            {audit.map((a) => (
              <li key={a.id}>
                {formatDateTime(a.at, tz)}: {a.action} by {a.actor}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
