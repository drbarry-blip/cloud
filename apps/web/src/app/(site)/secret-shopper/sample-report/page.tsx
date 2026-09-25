import type { Metadata } from "next";
import { connection } from "next/server";
import { ReportView } from "@/components/report/ReportView";
import { sampleReport } from "@/lib/shopper/sample";

export const metadata: Metadata = {
  title: "Sample Secret Shopper report",
  description: "A complete Secret Shopper report for a fictional med spa: timeline, scorecard, top fixes, scripts, and a missed-revenue estimate.",
};

export default async function SampleReportPage() {
  await connection();
  const sample = await sampleReport();
  return <ReportView report={sample.report} kind={sample.kind} dates={sample.dates} mode="sample" headline={sample.headline} history={[]} evidence={null} />;
}
