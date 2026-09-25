import type { Metadata } from "next";
import Link from "next/link";
import { SAFE_TEMPLATE_IDS } from "@cgs/core";
import { getPlaybook } from "@/lib/playbook";
import { clinicSlug, SCENARIO_COPY } from "@/lib/safe-replies";

export const metadata: Metadata = {
  title: "Safe Review Reply Examples for Clinics",
  description: "Privacy-safe examples for replying to positive, negative, and mixed reviews, for med spas, hormone and weight-loss clinics, dental practices, and chiropractic, PT, and wellness clinics.",
};

export default function SafeRepliesIndex() {
  const clinicTypes = Object.values(getPlaybook().clinicTypes);
  return (
    <div className="container">
      <section className="hero">
        <p className="eyebrow">Free library</p>
        <h1>Safe review reply examples</h1>
        <p className="lead">
          Replies that thank reviewers and handle complaints without confirming anyone is a patient or mentioning their care.
          Pick your clinic type and situation.
        </p>
      </section>
      <div className="grid grid-2">
        {clinicTypes.map((c) => (
          <section key={c.id} className="card">
            <h2 style={{ marginTop: 0 }}>{c.name}</h2>
            <div className="pill-links">
              {SAFE_TEMPLATE_IDS.map((id) => (
                <Link key={id} href={`/safe-replies/${clinicSlug(c.id)}/${SCENARIO_COPY[id].slug}`}>
                  Replying to {SCENARIO_COPY[id].title}
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
      <p style={{ marginTop: 24 }}>
        Have a reply drafted already? <Link href="/tools/review-reply-checker">Check it for privacy risks</Link>.
      </p>
    </div>
  );
}
