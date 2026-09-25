import { US_TIMEZONES } from "@cgs/core";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { config } from "@/lib/config";
import { getPlaybook } from "@/lib/playbook";
import { formatUsd, PRICES } from "@/lib/shopper/purchase";
import { StartWizard } from "./StartWizard";

export const metadata: Metadata = {
  title: "Start a Secret Shopper test",
  description: "Set up a Speed-to-Lead Secret Shopper test for your clinic in about five minutes.",
};

export default async function StartPage({ searchParams }: { searchParams: Promise<{ cancelled?: string }> }) {
  await connection();
  if (!config.shopperOpen()) redirect("/secret-shopper#waitlist");
  const { cancelled } = await searchParams;
  const clinicTypes = Object.values(getPlaybook().clinicTypes).map((c) => ({
    id: c.id,
    name: c.name,
    services: c.services.map((s) => ({ id: s.id, name: s.name })),
  }));
  return (
    <div className="container narrow">
      <section className="hero">
        <p className="eyebrow">Secret Shopper</p>
        <h1>Set up your test</h1>
        <p className="lead">About five minutes. We&apos;ll ask where new patients reach you, when you&apos;re open, and which services to ask about.</p>
      </section>
      <StartWizard
        clinicTypes={clinicTypes}
        timezones={US_TIMEZONES}
        googleEnabled={Boolean(config.googleMapsKey())}
        turnstileSiteKey={config.turnstile()?.siteKey ?? null}
        priceLabel={formatUsd(PRICES.baseline.cents)}
        cancelled={cancelled === "1"}
      />
    </div>
  );
}
