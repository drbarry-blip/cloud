import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container narrow">
      <section className="hero">
        <h1>Page not found</h1>
        <p className="lead">That page doesn&apos;t exist. Try one of our free tools instead.</p>
        <div className="row">
          <Link className="btn btn-primary" href="/tools/visibility-score">Visibility Score</Link>
          <Link className="btn btn-secondary" href="/tools/review-reply-checker">Reply Checker</Link>
        </div>
      </section>
    </div>
  );
}
