import type { Metadata } from "next";
import { connection } from "next/server";
import { ReportView } from "@/components/report/ReportView";
import { config } from "@/lib/config";
import { liveShopperDeps } from "@/lib/shopper/deps";
import { reviveReport } from "@/lib/shopper/grade";
import { testDates } from "@/lib/shopper/schedule";
import { verifyToken } from "@/lib/tokens";

export const metadata: Metadata = { title: "Secret Shopper report", robots: { index: false, follow: false } };

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
  const raw = decodeURIComponent(token);
  const testId = verifyToken(raw, "report");
  if (!testId) return <NotFound />;
  const { repo } = await liveShopperDeps();
  const test = await repo.getTest(testId);
  const report = test ? reviveReport(test.result) : null;
  if (!test || !report || !["qa", "delivered"].includes(test.status)) return <NotFound />;
  const clinic = (await repo.getClinic(test.clinicId))!;
  const history = (await repo.deliveredTests(clinic.id)).filter((t) => t.id !== test.id && t.score != null).slice(0, 6);
  return (
    <ReportView
      report={report}
      kind={test.kind}
      dates={testDates(test, clinic)}
      mode={test.status === "qa" ? "qa" : "delivered"}
      headline={test.headlineOverride ?? report.grade.headline}
      history={history.map((t) => ({ score: t.score!, deliveredAt: t.deliveredAt }))}
      evidence={{ tokenParam: encodeURIComponent(raw), recordings: Boolean(config.twilio()) }}
    />
  );
}
