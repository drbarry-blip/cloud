import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { allSafeReplyParams, getSafeReplyPage } from "@/lib/safe-replies";

type Params = { clinicType: string; scenario: string };

export function generateStaticParams(): Params[] {
  return allSafeReplyParams();
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { clinicType, scenario } = await params;
  const page = getSafeReplyPage(clinicType, scenario);
  if (!page) return {};
  return {
    title: page.title,
    description: `A privacy-safe way to reply to ${page.situation.toLowerCase()} Includes a template and the mistakes to avoid.`,
  };
}

const CATEGORY_LABELS: Record<string, string> = {
  confirms_patient: "confirms they're a patient",
  treatment_details: "mentions their treatment",
  identifiers: "includes identifying details",
  billing_insurance: "discusses billing or insurance",
  arguing_care: "argues about their care",
  tone: "sounds defensive",
  no_private_path: "doesn't offer a private conversation",
};

export default async function SafeReplyPage({ params }: { params: Promise<Params> }) {
  const { clinicType, scenario } = await params;
  const page = getSafeReplyPage(clinicType, scenario);
  if (!page) notFound();

  return (
    <div className="container">
      <article className="prose">
        <p className="small"><Link href="/safe-replies">Safe replies</Link> / {page.clinicType.name}</p>
        <h1>{page.title}</h1>
        <p className="lead muted">{page.situation}</p>

        <h2>A safe reply you can adapt</h2>
        <p className="template">{page.template}</p>
        <p className="small muted">{page.templateWhy}</p>

        <h2>A reply to avoid</h2>
        <p className="bad-example">{page.avoid}</p>
        <p>Our checker flags this reply because it:</p>
        <ul>
          {[...new Map(page.avoidFlags.map((f) => [f.category, f])).values()].map((f) => (
            <li key={f.category}>
              <strong>{CATEGORY_LABELS[f.category] ?? f.category}</strong>
              {f.match ? <> (&ldquo;{f.match}&rdquo;)</> : null}: {f.reason}
            </li>
          ))}
        </ul>

        <h2>Rules of thumb</h2>
        <ul>
          {page.rewriteRules.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>

        <div className="card" style={{ marginTop: 24 }}>
          <h3>Check your own reply before you post it</h3>
          <p>Paste your draft and get a verdict in seconds, plus safe rewrites.</p>
          <Link className="btn btn-primary" href="/tools/review-reply-checker">Open the Reply Checker</Link>
        </div>
        <p className="small muted" style={{ marginTop: 16 }}>General guidance, not legal advice.</p>
      </article>
    </div>
  );
}
