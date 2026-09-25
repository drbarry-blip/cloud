import type { Metadata } from "next";
import Link from "next/link";
import { ActionButton } from "@/components/ActionButton";
import { SignInForm } from "@/components/SignInForm";
import { getAccountLeadId } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { liveShopperDeps } from "@/lib/shopper/deps";
import { formatUsd, PRICES } from "@/lib/shopper/purchase";
import { reportUrl } from "@/lib/shopper/report";
import { orderStatusUrl, testDates } from "@/lib/shopper/schedule";

export const metadata: Metadata = { title: "Your account", robots: { index: false, follow: false } };

const STATUS: Record<string, string> = {
  awaiting_payment: "Waiting",
  awaiting_verification: "Verifying",
  scheduled: "Scheduled",
  running: "In progress",
  grading: "Finishing",
  qa: "Report in review",
  delivered: "Report ready",
  cancelled: "Cancelled",
  failed: "Couldn't complete",
};

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ retests?: string }> }) {
  const leadId = await getAccountLeadId();
  const { retests } = await searchParams;
  if (!leadId) {
    return (
      <div className="container narrow">
        <section className="hero">
          <h1>Your account</h1>
          <p className="lead">See your tests and reports, and manage Monthly Retests. We&apos;ll email you a sign-in link.</p>
        </section>
        <div className="card">
          <SignInForm endpoint="/api/auth/account-link" hint="Use the email you ordered with." />
        </div>
      </div>
    );
  }
  const deps = await liveShopperDeps();
  const { repo } = deps;
  const lead = await deps.store.getLead(leadId);
  const clinics = await repo.clinicsForLead(leadId);

  return (
    <div className="container narrow stack">
      <section className="hero" style={{ paddingBottom: 0 }}>
        <h1>Your account</h1>
        <p className="lead" style={{ marginBottom: 0 }}>{lead?.email}</p>
      </section>
      {retests === "started" ? <p className="notice">Monthly Retests are on. Your next test is scheduled; we&apos;ll email you the dates.</p> : null}

      {clinics.length === 0 ? (
        <div className="card">
          <p style={{ margin: 0 }}>
            No tests yet. <Link href="/secret-shopper">Start a Secret Shopper test</Link>.
          </p>
        </div>
      ) : null}

      {await Promise.all(
        clinics.map(async (clinic) => {
          const tests = (await repo.testsForClinic(clinic.id)).filter((t) => t.status !== "awaiting_payment" || t.subscriptionId);
          const subs = await repo.subscriptionsForClinic(clinic.id);
          const activeSub = subs.find((s) => s.status !== "canceled");
          const delivered = tests.filter((t) => t.status === "delivered" && t.score != null).reverse();
          return (
            <div className="card stack" key={clinic.id}>
              <h2 style={{ margin: 0 }}>{clinic.name}</h2>
              {delivered.length > 1 ? (
                <div aria-label="Score history">
                  <p className="small muted" style={{ margin: "0 0 4px" }}>Score history</p>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 70 }}>
                    {delivered.map((t) => (
                      <div key={t.id} title={`${t.score} on ${formatDate(t.deliveredAt, clinic.timezone)}`} style={{ flex: 1, maxWidth: 40, height: `${Math.max(6, t.score!)}%`, background: "var(--brand)", borderRadius: 4 }} />
                    ))}
                  </div>
                </div>
              ) : null}
              <ul className="task-list">
                {tests.map((t) => (
                  <li key={t.id}>
                    <span>
                      {t.kind === "baseline" ? "Baseline test" : t.kind === "quarterly" ? "Quarterly test" : "Monthly retest"} · {testDates(t, clinic) ?? "dates coming soon"}
                      <br />
                      <span className="small muted">
                        {STATUS[t.status]}
                        {t.grade ? ` · Grade ${t.grade} (${t.score})` : ""}
                      </span>
                    </span>
                    <span className="small">
                      {t.status === "delivered" ? <a href={reportUrl("", t.id)}>Open report</a> : t.orderId ? <a href={orderStatusUrl("", t.orderId)}>Details</a> : null}
                    </span>
                  </li>
                ))}
              </ul>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {activeSub ? (
                  <span className="pill pill-ok">Monthly Retests {activeSub.status === "active" ? "on" : "(payment issue)"}</span>
                ) : tests.some((t) => t.status === "delivered") ? (
                  <ActionButton endpoint="/api/account/retest" body={{ clinicId: clinic.id }} label={`Add Monthly Retests (${formatUsd(PRICES.retest_monthly.cents)}/month)`} variant="primary" />
                ) : (
                  <span className="small muted">Monthly Retests become available when your first report is ready.</span>
                )}
              </div>
            </div>
          );
        }),
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        <ActionButton endpoint="/api/account/portal" body={{}} label="Billing and invoices" />
        <ActionButton endpoint="/api/auth/sign-out" body={{}} label="Sign out" redirectTo="/account" />
      </div>
    </div>
  );
}
