import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { liveShopperDeps } from "@/lib/shopper/deps";
import { canAutoVerify, formatUsd } from "@/lib/shopper/purchase";
import type { TestStatus } from "@/lib/shopper/repo";
import { reportUrl } from "@/lib/shopper/report";
import { testDates } from "@/lib/shopper/schedule";
import { verifyToken } from "@/lib/tokens";
import { ClinicCode } from "./ClinicCode";

export const metadata: Metadata = { title: "Your Secret Shopper order", robots: { index: false, follow: false } };

const STAGES: { label: string; reached: TestStatus[] }[] = [
  { label: "Paid", reached: ["awaiting_verification", "scheduled", "running", "grading", "qa", "delivered"] },
  { label: "Ownership verified", reached: ["scheduled", "running", "grading", "qa", "delivered"] },
  { label: "Inquiries under way", reached: ["running", "grading", "qa", "delivered"] },
  { label: "Report ready", reached: ["delivered"] },
];

export default async function OrderPage({ searchParams }: { searchParams: Promise<{ t?: string; paid?: string }> }) {
  await connection();
  const { t, paid } = await searchParams;
  const orderId = verifyToken(t, "order");
  const deps = orderId ? await liveShopperDeps() : null;
  const order = orderId && deps ? await deps.repo.getOrder(orderId) : null;
  if (!deps || !order || !t) {
    return (
      <div className="container narrow">
        <section className="hero">
          <h1>Order not found</h1>
          <p className="lead">This link is incomplete or out of date. Please use the latest link from your email.</p>
        </section>
      </div>
    );
  }
  const clinic = (await deps.repo.getClinic(order.clinicId))!;
  const test = await deps.repo.testForOrder(order.id);
  const lead = await deps.store.getLead(order.leadId);
  const status = test?.status ?? "awaiting_payment";
  const dates = test ? testDates(test, clinic) : null;
  const currentStage = STAGES.findIndex((s) => !s.reached.includes(status));

  return (
    <div className="container narrow">
      <section className="hero">
        <p className="eyebrow">Secret Shopper order</p>
        <h1>{clinic.name}</h1>
        <p className="lead">
          {order.product === "retest_monthly" ? "Monthly Retest" : "Baseline Test"} · {formatUsd(order.amountCents)}
          {order.status === "refunded" ? " · Refunded" : ""}
        </p>
      </section>

      {paid === "1" && order.status === "pending" ? <p className="notice">We&apos;re confirming your payment. Refresh this page in a minute.</p> : null}

      <div className="card">
        <ol className="status-steps">
          {STAGES.map((s, i) => (
            <li key={s.label} className={s.reached.includes(status) ? "done" : i === currentStage && status !== "cancelled" && status !== "failed" ? "current" : ""}>
              {s.label}
            </li>
          ))}
        </ol>
      </div>

      {status === "awaiting_payment" ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Waiting for payment</h2>
          <p>We haven&apos;t received payment for this order yet. If you just paid, refresh in a minute.</p>
          <Link className="btn btn-secondary" href="/secret-shopper/start">
            Back to setup
          </Link>
        </div>
      ) : null}

      {status === "awaiting_verification" && clinic.verificationStatus === "pending" ? (
        <div className="card stack">
          <h2 style={{ marginTop: 0 }}>Verifying that you manage the clinic</h2>
          {lead && canAutoVerify(lead.email, clinic) ? (
            <p>Check your inbox at {lead.email} for a confirmation link. Clicking it verifies the clinic and schedules your test.</p>
          ) : (
            <>
              <p>
                This protects clinics from fake leads sent by someone else. Our team usually verifies within one business day, and may email you to
                ask for a document such as a business license.
              </p>
              {clinic.publicEmail ? (
                <>
                  <h3 style={{ marginBottom: 0 }}>Want it sooner?</h3>
                  <ClinicCode token={t} publicEmail={clinic.publicEmail} />
                </>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {status === "awaiting_verification" && clinic.verificationStatus === "verified" ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Verified</h2>
          <p>{test?.statusNote && test.statusNote !== "Scheduled" ? "Our team is finishing your test schedule and will email you the dates shortly." : "We're scheduling your test now."}</p>
        </div>
      ) : null}

      {status === "scheduled" || status === "running" ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Your test runs {dates}</h2>
          <p>Please keep the dates to yourself so your team responds the way it normally would. We never share exact times, even with you.</p>
          <p className="small muted">
            Unexpected closure coming up? Reply to any of our emails and we&apos;ll reschedule. Please don&apos;t tell the team about the test.
          </p>
        </div>
      ) : null}

      {status === "grading" || status === "qa" ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Your test is finished</h2>
          <p>We&apos;re reviewing every response and writing your report. It usually arrives within one business day.</p>
        </div>
      ) : null}

      {status === "delivered" ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Your report is ready</h2>
          <p>
            <a className="btn btn-primary" href={reportUrl("", test!.id)}>
              Open your report
            </a>
          </p>
        </div>
      ) : null}

      {status === "cancelled" || status === "failed" ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>{status === "cancelled" ? "This test was cancelled" : "This test couldn't be completed"}</h2>
          {test?.statusNote ? <p>{test.statusNote}</p> : null}
          <p className="small muted">Questions? Reply to any of our emails.</p>
        </div>
      ) : null}
    </div>
  );
}
