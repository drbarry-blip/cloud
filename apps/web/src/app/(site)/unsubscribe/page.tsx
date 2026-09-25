import type { Metadata } from "next";
import { TokenAction } from "@/components/TokenAction";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false } };

export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  return (
    <div className="container narrow">
      <section className="hero">
        <h1>Unsubscribe</h1>
        <p className="lead">Stop all marketing email from us. You can still use the free tools.</p>
      </section>
      <TokenAction endpoint="/api/unsubscribe" token={t ?? null} buttonLabel="Unsubscribe me" doneMessage="You're unsubscribed. You won't get any more marketing email from us." />
    </div>
  );
}
