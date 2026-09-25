import type { Metadata } from "next";
import { connection } from "next/server";
import { config } from "@/lib/config";
import { clinicTypeOptions } from "@/lib/playbook";
import { VisibilityTool } from "./VisibilityTool";

export const metadata: Metadata = {
  title: "Free Clinic Visibility Score",
  description: "See how your clinic compares with nearby competitors on Google rating, reviews, website speed, and how easy it is to book. Free, in about a minute.",
};

export default async function VisibilityScorePage() {
  await connection(); // reads runtime configuration
  return (
    <div className="container narrow">
      <section className="hero">
        <p className="eyebrow">Free tool</p>
        <h1>How does your clinic stack up nearby?</h1>
        <p className="lead">
          A free score out of 100 comparing your Google rating, reviews, website speed, and how easy it is to book, against
          clinics near you. It takes about a minute.
        </p>
      </section>
      <VisibilityTool clinicTypes={clinicTypeOptions()} turnstileSiteKey={config.turnstile()?.siteKey ?? null} enabled={Boolean(config.googleMapsKey())} />
      <section className="prose">
        <h2>What we check</h2>
        <ul>
          <li><strong>Reputation:</strong> your rating and review count against nearby competitors, and how recent your newest review is.</li>
          <li><strong>Booking ease:</strong> online booking, tap-to-call on phones, a short contact form, text or chat, and a booking button near the top of your homepage.</li>
          <li><strong>Website speed:</strong> Google&apos;s mobile speed test and real-visitor experience data.</li>
          <li><strong>Profile completeness:</strong> hours, website, phone, and photos on your Google profile.</li>
        </ul>
        <p className="small muted">
          We use public data from Google and your public website. We don&apos;t store Google&apos;s ratings or reviews, only your
          score. Scores are estimates, not guarantees.
        </p>
      </section>
    </div>
  );
}
