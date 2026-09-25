import type { Metadata } from "next";
import { TokenAction } from "@/components/TokenAction";

export const metadata: Metadata = { title: "Confirm your email", robots: { index: false } };

export default async function ConfirmPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  return (
    <div className="container narrow">
      <section className="hero">
        <h1>Confirm your email</h1>
        <p className="lead">Click below to confirm, and we&apos;ll send you occasional tips on turning more inquiries into patients.</p>
      </section>
      <TokenAction endpoint="/api/confirm" token={t ?? null} buttonLabel="Confirm my email" doneMessage="You're confirmed. Thanks! You can unsubscribe from any email." />
    </div>
  );
}
