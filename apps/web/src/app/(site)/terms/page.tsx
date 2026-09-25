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
        <h2>Secret Shopper</h2>
        <p>When you order a Secret Shopper test or Monthly Retests:</p>
        <ul>
          <li>
            <strong>You confirm you&apos;re authorized.</strong> You warrant that you own or manage the clinic, that you may authorize
            fictional new-patient inquiries to it, and that the forms and email address you give us are the clinic&apos;s own. You agree
            to indemnify us for claims arising from a test you weren&apos;t authorized to order.
          </li>
          <li>
            <strong>We verify first.</strong> No inquiry is sent until we&apos;ve verified that you own or manage the clinic. If we
            can&apos;t, we cancel the order and refund it in full.
          </li>
          <li>
            <strong>What the fictional patients do.</strong> They contact the clinic by web form and email, may reply once, and never
            book, hold, or cancel appointments, give payment details, share health details, or call the clinic. Calls and texts to
            their numbers are logged, and voicemails are recorded and transcribed.
          </li>
          <li>
            <strong>Afterward,</strong> please delete the fictional leads listed in your report&apos;s cleanup list from your
            systems.
          </li>
          <li>
            <strong>Guarantee.</strong> If we can&apos;t deliver at least two inquiries, we refund the test in full. If you cancel
            during a test, we stop sending, send a report on what happened so far, and refund in proportion.
          </li>
          <li>
            <strong>Monthly Retests</strong> renew each month until you cancel, which you can do any time from your account.
          </li>
          <li>
            Reports describe how your clinic responded to fictional inquiries and suggest improvements. Observations about wording
            are not legal conclusions, and results are grouped by channel and time, not by staff member.
          </li>
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
