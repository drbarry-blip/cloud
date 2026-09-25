import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { config } from "@/lib/config";
import { clinicTypeOptions } from "@/lib/playbook";
import { ReplyChecker } from "./ReplyChecker";

export const metadata: Metadata = {
  title: "HIPAA-Safe Review Reply Checker",
  description: "Paste your reply to an online review before you post it. We flag anything that could confirm someone is a patient or reveal their care, then rewrite it safely.",
};

export default async function ReplyCheckerPage() {
  await connection(); // reads runtime configuration
  return (
    <div className="container narrow">
      <section className="hero">
        <p className="eyebrow">Free tool</p>
        <h1>HIPAA-safe review reply checker</h1>
        <p className="lead">
          Paste your reply before you post it. We&apos;ll flag anything that confirms the reviewer is a patient or mentions their
          care, then help you rewrite it.
        </p>
      </section>
      <p className="notice small">
        <strong>Privacy:</strong> don&apos;t paste patient names or anything you wouldn&apos;t post publicly. We check your text in
        memory and never store or log it. This page has no analytics. <Link href="/privacy">How we handle data</Link>
      </p>
      <ReplyChecker clinicTypes={clinicTypeOptions()} turnstileSiteKey={config.turnstile()?.siteKey ?? null} />
      <section className="prose">
        <h2>Why this matters</h2>
        <p>
          Replying to reviews builds trust, but a reply that confirms someone is your patient, or mentions their treatment, can
          be a privacy violation. Federal regulators have fined practices tens of thousands of dollars over review replies.
          Google has also started testing AI-written replies, and generic AI doesn&apos;t know these rules.
        </p>
        <p>
          Not sure where to start? Browse <Link href="/safe-replies">safe reply examples</Link> for common situations.
        </p>
        <p className="small muted">This tool gives general guidance, not legal advice.</p>
      </section>
    </div>
  );
}
