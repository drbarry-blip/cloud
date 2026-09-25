import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <div className="container">
      <article className="prose">
        <h1>Privacy</h1>
        <p className="notice notice-warn small">
          Draft, pending review by a healthcare attorney before launch (SPEC.md §9.8). The design below is how the product
          works today.
        </p>
        <h2>The short version</h2>
        <ul>
          <li>We don&apos;t want patient information, and our tools are designed to work without it.</li>
          <li>Text you paste into the Reply Checker is checked in memory and never stored or logged.</li>
          <li>We don&apos;t store Google&apos;s ratings or reviews, only the scores we calculate.</li>
          <li>We email you only if you ask, and marketing email only after you confirm your address.</li>
        </ul>
        <h2>What we collect</h2>
        <ul>
          <li><strong>Email address</strong>, if you give it, with which tool you used and whether you agreed to marketing email.</li>
          <li><strong>Reply Checker results</strong>: the verdict and the types of issues found, never the text itself.</li>
          <li><strong>Visibility Scores</strong>: the Google place ID, clinic name, and the scores we calculated.</li>
          <li><strong>Usage limits</strong>: daily counters keyed by a one-way hash of your IP address or email.</li>
          <li><strong>Page views</strong> on most pages, through privacy-friendly analytics with no cookies. The Reply Checker page has no analytics.</li>
        </ul>
        <h2>Services we use</h2>
        <p>
          Google (Maps and PageSpeed data), Anthropic (AI review of pasted replies), Cloudflare (bot protection), our email
          provider, and our hosting and database providers. Pasted replies are sent to Anthropic only to produce your result.
        </p>
        <h2>Please don&apos;t paste patient information</h2>
        <p>
          The Reply Checker is for replies you intend to post publicly. If you paste something by mistake, it isn&apos;t
          stored, but please avoid it anyway.
        </p>
        <h2>Your choices</h2>
        <ul>
          <li>Unsubscribe from any email with one click.</li>
          <li>Ask us to delete your email address and related records. We&apos;ll do it within 30 days.</li>
        </ul>
        <p className="small muted">{BRAND.name} · Contact details will appear here before launch.</p>
      </article>
    </div>
  );
}
