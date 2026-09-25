import type { Metadata } from "next";
import { TokenAction } from "@/components/TokenAction";

export const metadata: Metadata = { title: "Confirm your email", robots: { index: false, follow: false } };

export default async function ShopperConfirmPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  return (
    <div className="container narrow">
      <section className="hero">
        <h1>Confirm your email</h1>
        <p className="lead">This confirms your address and, because it matches your clinic&apos;s website, verifies that you manage the clinic.</p>
      </section>
      <div className="card">
        <TokenAction
          endpoint="/api/shopper/confirm"
          token={t ?? null}
          buttonLabel="Confirm and start my test"
          doneMessage="Thanks, you're verified. We're scheduling your test and will email you the dates."
        />
      </div>
    </div>
  );
}
