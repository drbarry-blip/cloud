import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { EmailCapture } from "@/components/EmailCapture";
import { config } from "@/lib/config";
import { formatUsd, PRICES } from "@/lib/shopper/purchase";

export const metadata: Metadata = {
  title: "Speed-to-Lead Secret Shopper for Clinics",
  description: "Find out what really happens when a new patient contacts your clinic. Fictional inquiries, a graded report, and scripts to fix what's broken.",
};

const FAQ = [
  {
    q: "Will my team know it's a test?",
    a: "No. The inquiries come from fictional people with their own email addresses and local phone numbers, at random times inside normal windows. We never share exact times, even with you.",
  },
  {
    q: "Does anything get booked on our schedule?",
    a: "Never. The fictional patients don't book, hold appointments, or use your online booking tool. They also never share health details or payment information.",
  },
  {
    q: "Is any patient data involved?",
    a: "No. Everyone in the test is fictional. If your team ever sends a real patient's information to a test address by mistake, we lock it down, tell you, and delete it within 7 days.",
  },
  {
    q: "What do I do afterward?",
    a: "Share the scripts with your front desk, and delete the test leads from your systems. The report includes a cleanup list with every fictional name, email, and phone number.",
  },
  {
    q: "How do you know I'm allowed to test this clinic?",
    a: "Before anything is sent, we verify that you own or manage the clinic. If we can't, you get a full refund. We never test a clinic that didn't ask.",
  },
];

export default async function SecretShopperPage() {
  await connection();
  const open = config.shopperOpen();
  return (
    <div className="container narrow">
      <section className="hero">
        <p className="eyebrow">{open ? "Speed-to-Lead Secret Shopper" : "Coming soon"}</p>
        <h1>Find out what really happens when a new patient reaches out</h1>
        <p className="lead">
          Most owners don&apos;t know how many leads their front desk loses. The Secret Shopper shows you in two weeks, without a
          sales call.
        </p>
        {open ? (
          <p>
            <Link className="btn btn-primary" href="/secret-shopper/start">
              Start a test ({formatUsd(PRICES.baseline.cents)})
            </Link>
          </p>
        ) : null}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>How it works</h2>
        <ol>
          <li>You pick the services to test and confirm you own or manage the clinic.</li>
          <li>Over about four days, three fictional new patients contact your clinic through your website form and email.</li>
          <li>We log every call, voicemail, text, and email your team sends back for 10 days. Nothing is ever booked on your schedule.</li>
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
        <h2 style={{ marginTop: 0 }}>{open ? "Pricing" : "Planned pricing"}</h2>
        <ul>
          <li><strong>{formatUsd(PRICES.baseline.cents)}</strong> for a Baseline Test: 3 fictional inquiries and a full report</li>
          <li><strong>{formatUsd(PRICES.retest_monthly.cents)}/month</strong> for Monthly Retests with trend tracking, added after your Baseline Test; cancel any time</li>
        </ul>
        {open ? (
          <>
            <p className="small muted">Full refund if we can&apos;t deliver at least two inquiries, or if we can&apos;t verify you manage the clinic.</p>
            <Link className="btn btn-primary" href="/secret-shopper/start">Start a test</Link>
          </>
        ) : (
          <p className="small muted">Pricing may change before launch. Waitlist members get launch pricing.</p>
        )}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Questions</h2>
        {FAQ.map((f) => (
          <details key={f.q} style={{ marginBottom: 10 }}>
            <summary style={{ fontWeight: 600, cursor: "pointer" }}>{f.q}</summary>
            <p style={{ margin: "6px 0 0" }}>{f.a}</p>
          </details>
        ))}
      </section>

      {open ? null : (
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
      )}
    </div>
  );
}
