import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <div className="container">
      <article className="prose">
        <h1>Terms of use</h1>
        <p className="notice notice-warn small">Draft, pending review by an attorney before launch (SPEC.md §9.8).</p>
        <h2>Free tools</h2>
        <p>
          {BRAND.name}&apos;s free tools give general information and automated estimates. They aren&apos;t legal, medical, or
          compliance advice, and a &quot;safe&quot; result doesn&apos;t guarantee that a reply complies with any law.
        </p>
        <h2>Acceptable use</h2>
        <ul>
          <li>Don&apos;t paste patient information or anything you don&apos;t have the right to share.</li>
          <li>Don&apos;t automate, scrape, or overload the tools, or get around their limits.</li>
          <li>Visibility Scores use public data and may be incomplete or out of date.</li>
        </ul>
        <h2>Data from Google</h2>
        <p>Ratings and review counts shown in the Visibility Score come from Google Maps and are subject to Google&apos;s terms.</p>
        <h2>Changes</h2>
        <p>We may update these terms. We&apos;ll change the date below when we do.</p>
        <p className="small muted">Last updated: draft.</p>
      </article>
    </div>
  );
}
