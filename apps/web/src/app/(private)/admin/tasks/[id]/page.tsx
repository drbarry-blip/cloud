import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { formatDateTime, formatPhone, relativeTime } from "@/lib/format";
import { canSeeTask } from "@/lib/shopper/admin";
import { liveShopperDeps } from "@/lib/shopper/deps";
import { reviveReport } from "@/lib/shopper/grade";
import { reportUrl } from "@/lib/shopper/report";
import { TASK_INFO } from "../../task-info";
import { TaskActions } from "./TaskActions";

export const metadata = { title: "Task" };

function CopyRow({ label, value }: { label: string; value: string | null }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>
        <code>{value ?? "–"}</code>
      </dd>
    </>
  );
}

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const deps = await liveShopperDeps();
  const { repo } = deps;
  const task = await repo.getTask(id);
  if (!task || !canSeeTask(staff, task)) notFound();
  const info = TASK_INFO[task.type];
  const test = task.testId ? await repo.getTest(task.testId) : null;
  const clinic = task.clinicId ? await repo.getClinic(task.clinicId) : test ? await repo.getClinic(test.clinicId) : null;
  const tz = clinic?.timezone;
  const assignment = task.assignmentId ? await repo.getAssignment(task.assignmentId) : null;
  const event = task.inboundEventId ? await repo.getInbound(task.inboundEventId) : null;
  const payload = task.payload as Record<string, unknown>;
  const evidence = (payload.evidence ?? {}) as Record<string, unknown>;

  // For matching: every persona on a running test.
  let personas: { id: string; label: string }[] = [];
  if (task.type === "match_inbound") {
    for (const t of await repo.testsWithStatus(["running", "scheduled"])) {
      const c = await repo.getClinic(t.clinicId);
      for (const a of await repo.assignmentsForTest(t.id)) {
        personas.push({ id: a.id, label: `${a.firstName} ${a.lastName} · ${a.email} · ${formatPhone(a.phoneNumber)} · ${c?.name ?? ""}` });
      }
    }
    personas = personas.slice(0, 300);
  }
  const report = test ? reviveReport(test.result) : null;
  const showBody = event && (!event.phiQuarantined || staff.role === "admin");

  return (
    <div className="stack">
      <p className="small" style={{ margin: 0 }}>
        <Link href="/admin">← Queue</Link>
      </p>
      <h1 style={{ margin: 0 }}>{task.title}</h1>
      <p className="small muted" style={{ margin: 0 }}>
        {info.label} · {task.status === "open" ? (task.dueAt ? `Due ${relativeTime(task.dueAt)} (${formatDateTime(task.dueAt, tz)})` : "No deadline") : `Closed: ${task.resolution ?? task.status}`}
        {test ? (
          <>
            {" "}
            · <Link href={`/admin/tests/${test.id}`}>Open the test</Link>
          </>
        ) : null}
      </p>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>How to do this</h2>
        <ul style={{ margin: 0 }}>
          {info.how.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
        {typeof payload.reason === "string" ? <p className="notice notice-warn" style={{ marginBottom: 0 }}>{payload.reason}</p> : null}
        {Array.isArray(payload.notes) && payload.notes.length ? (
          <ul className="notice notice-warn" style={{ marginBottom: 0 }}>
            {(payload.notes as string[]).map((n) => (
              <li key={n} style={{ marginLeft: 16 }}>{n}</li>
            ))}
          </ul>
        ) : null}
      </div>

      {task.type === "verify_ownership" ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Buyer and clinic</h2>
          <dl className="kv">
            <dt>Buyer</dt>
            <dd>{String(payload.buyerEmail ?? "–")}</dd>
            <dt>Clinic</dt>
            <dd>{clinic?.name}</dd>
            <dt>Address</dt>
            <dd>{clinic?.address ?? "–"}</dd>
            <dt>Website</dt>
            <dd>{clinic?.website ? <a href={clinic.website} target="_blank" rel="noopener noreferrer">{clinic.website}</a> : "–"}</dd>
            <dt>Google</dt>
            <dd>{clinic?.placeId ? <a href={`https://www.google.com/maps/place/?q=place_id:${clinic.placeId}`} target="_blank" rel="noopener noreferrer">Open the listing</a> : "Not linked"}</dd>
            <dt>Phone</dt>
            <dd>{clinic?.phone ?? "–"}</dd>
            <dt>Public email</dt>
            <dd>{clinic?.publicEmail ?? "–"}</dd>
            <dt>Form pages</dt>
            <dd>{clinic?.formUrls.join(", ") || "–"}</dd>
          </dl>
          {Array.isArray(payload.flags) && payload.flags.length ? (
            <ul className="notice notice-warn" style={{ marginBottom: 0 }}>
              {(payload.flags as string[]).map((f) => (
                <li key={f} style={{ marginLeft: 16 }}>{f}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {assignment && (task.type === "submit_form" || task.type === "fix_failure") ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Persona details</h2>
          <dl className="kv">
            <dt>Form page</dt>
            <dd>{assignment.target ? <a href={assignment.target} target="_blank" rel="noopener noreferrer">{assignment.target}</a> : "–"}</dd>
            <CopyRow label="First name" value={assignment.firstName} />
            <CopyRow label="Last name" value={assignment.lastName} />
            <CopyRow label="Email" value={assignment.email} />
            <CopyRow label="Phone" value={assignment.phoneNumber ? formatPhone(assignment.phoneNumber) : null} />
            <CopyRow label="Subject" value={assignment.subject} />
            <dt>Service</dt>
            <dd>{assignment.serviceName}</dd>
            <dt>Scheduled</dt>
            <dd>{formatDateTime(assignment.scheduledAt, tz)}</dd>
          </dl>
          <p className="small muted" style={{ marginBottom: 4 }}>Message</p>
          <div className="message-box">{assignment.message}</div>
          {typeof evidence.form_before === "string" ? (
            <details style={{ marginTop: 12 }}>
              <summary className="small">What the bot saw</summary>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="shot" src={`/api/admin/evidence/${evidence.form_before}`} alt="The form before the bot filled it" />
            </details>
          ) : null}
        </div>
      ) : null}

      {event ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>The clinic&apos;s message</h2>
          <dl className="kv">
            <dt>Channel</dt>
            <dd>{event.channel}{event.voicemail ? " (voicemail)" : ""}</dd>
            <dt>From</dt>
            <dd>{event.fromAddr ?? "–"}</dd>
            <dt>To</dt>
            <dd>{event.toAddr ?? "–"}</dd>
            <dt>Received</dt>
            <dd>{formatDateTime(event.receivedAt, tz)}</dd>
            {event.subject && showBody ? (
              <>
                <dt>Subject</dt>
                <dd>{event.subject}</dd>
              </>
            ) : null}
          </dl>
          {showBody ? <div className="message-box" style={{ marginTop: 10 }}>{event.body || "(no text)"}</div> : <p className="notice notice-warn">Withheld: this message may contain patient information.</p>}
        </div>
      ) : null}

      {task.type === "review_phi" ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Why it was flagged</h2>
          <p style={{ margin: 0 }}>{(payload.signals as string[] | undefined)?.join(", ").replace(/_/g, " ")}</p>
        </div>
      ) : null}

      {task.type === "qa_report" && test ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Report</h2>
          <p style={{ margin: 0 }}>
            <a href={reportUrl("", test.id)} target="_blank" rel="noopener">Preview the report</a> · Grade {test.grade} ({test.score}) · graded by {report?.grade.method ?? "–"}
          </p>
        </div>
      ) : null}

      {task.status === "open" ? (
        <TaskActions
          taskId={task.id}
          type={task.type}
          isAdmin={staff.role === "admin"}
          draft={typeof payload.draft === "string" ? payload.draft : undefined}
          personas={personas}
          headline={test?.headlineOverride ?? report?.grade.headline}
        />
      ) : null}
    </div>
  );
}
