import Link from "next/link";

export default function Home() {
  return (
    <div className="container">
      <section className="hero">
        <p className="eyebrow">For independent clinics</p>
        <h1>Find the patients your clinic is losing</h1>
        <p className="lead">
          Free tools for med spas, hormone and weight-loss clinics, dental practices, and chiropractic, PT, and wellness
          clinics. No sales calls, no patient data.
        </p>
        <div className="row">
          <Link className="btn btn-primary" href="/tools/visibility-score">Get your free Visibility Score</Link>
          <Link className="btn btn-secondary" href="/tools/review-reply-checker">Check a review reply</Link>
        </div>
      </section>

      <div className="grid grid-2" style={{ marginTop: 32 }}>
        <section className="card">
          <p className="eyebrow">Free · about a minute</p>
          <h2 style={{ marginTop: 0 }}>Visibility Score</h2>
          <p>
            See how your Google rating, reviews, website speed, and booking experience compare with clinics near you, with
            your three quickest wins.
          </p>
          <Link href="/tools/visibility-score">Score my clinic →</Link>
        </section>
        <section className="card">
          <p className="eyebrow">Free · seconds</p>
          <h2 style={{ marginTop: 0 }}>HIPAA-safe Reply Checker</h2>
          <p>
            Paste a reply to an online review before you post it. We flag anything that confirms the reviewer is a patient or
            mentions their care, and suggest safe rewrites.
          </p>
          <Link href="/tools/review-reply-checker">Check a reply →</Link>
        </section>
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <p className="eyebrow">Coming soon</p>
        <h2 style={{ marginTop: 0 }}>The Speed-to-Lead Secret Shopper</h2>
        <p>
          Fictional new patients contact your clinic through your website and email. Two weeks later you get a graded report:
          how fast your team replied, how hard they followed up, and scripts to fix what&apos;s broken.
        </p>
        <Link className="btn btn-secondary" href="/secret-shopper">See how it works</Link>
      </section>

      <section className="prose">
        <h2>Why clinics trust these tools</h2>
        <ul>
          <li><strong>Built by clinic operators</strong> who&apos;ve run patient acquisition, not a generic marketing agency.</li>
          <li><strong>No patient data, ever.</strong> We work only with public information and fictional patients.</li>
          <li><strong>No sales calls.</strong> Everything is self-serve.</li>
        </ul>
      </section>
    </div>
  );
}
