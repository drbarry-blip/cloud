import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { config } from "@/lib/config";
import { verifyToken } from "@/lib/tokens";
import { DevPay } from "./DevPay";

export const metadata: Metadata = { title: "Test checkout", robots: { index: false, follow: false } };

/** Development only: stands in for Stripe Checkout when Stripe isn't configured. */
export default async function DevCheckoutPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  await connection();
  if (config.isProduction() || config.stripe()) notFound();
  const { t } = await searchParams;
  if (!t || !verifyToken(t, "order")) notFound();
  return (
    <div className="container narrow">
      <section className="hero">
        <p className="eyebrow">Development</p>
        <h1>Test checkout</h1>
        <p className="lead">Stripe isn&apos;t configured, so this page stands in for it. No money moves.</p>
      </section>
      <div className="card">
        <DevPay token={t} />
      </div>
    </div>
  );
}
