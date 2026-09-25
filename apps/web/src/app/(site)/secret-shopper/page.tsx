import type { Metadata } from "next";
import { EmailCapture } from "@/components/EmailCapture";

export const metadata: Metadata = {
  title: "Speed-to-Lead Secret Shopper for Clinics",
  description: "Find out what really happens when a new patient contacts your clinic. Fictional inquiries, a graded report, and scripts to fix what's broken. Coming soon.",
};

export default function SecretShopperPage() {
  return (
    <div className="container narrow">
      <section className="hero">
        <p className="eyebrow">Coming soon</p>
        <h1>Find out what really happens when a new patient reaches out</h1>
        <p className="lead">
          Most owners don&apos;t know how many leads their front desk loses. The Secret Shopper shows you in two weeks, without a
          sales call.
        </p>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>How it works</h2>
        <ol>
          <li>You pick the services to test and confirm you own or manage the clinic.</li>
          <li>Over about four days, three fictional new patients contact your clinic through your website form and email.</li>
          <li>We record every call, voicemail, text, and email your team sends back for 10 days. Nothing is ever booked on your schedule.</li>
          <li>You get a graded report with a timeline, your top three fixes, and scripts your front desk can use the same day.</li>
        </ol>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>What a report timeline looks like</h2>
        <p className="small muted">Example for a fictional clinic.</p>
        <ul className="timeline">
          <li>Tue 10:12 am: inquiry sent through the website form</li>
          <li>Tue 2:47 pm: first call back, 4.5 hours later; voicemail left without a callback number</li>
          <li className="bad">Wed–Fri: no follow-up</li>
          <li>Mon: one email with a booking link</li>
          <li className="bad">Days 7–10: nothing. The lead was dropped after 2 touches.</li>
        </ul>
        <p style={{ marginTop: 12 }}>
          <strong>Grade: D.</strong> Top fixes: call within the hour, always leave a callback number, and keep following up for
          10 days.
        </p>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Planned pricing</h2>
        <ul>
          <li><strong>$199</strong> for a Baseline Test: 3 fictional inquiries and a full report</li>
          <li><strong>$99/month</strong> for Monthly Retests with trend tracking; cancel any time</li>
        </ul>
        <p className="small muted">Pricing may change before launch. Waitlist members get launch pricing.</p>
      </section>

      <div id="waitlist">
        <EmailCapture
          source="secret_shopper_waitlist"
          heading="Join the waitlist"
          description="We'll email you once when it launches, plus a few tips on converting more inquiries."
          buttonLabel="Join the waitlist"
          consentLabel="Yes, email me when the Secret Shopper launches and send occasional tips. Unsubscribe any time."
          requireConsent
        />
      </div>
    </div>
  );
}
