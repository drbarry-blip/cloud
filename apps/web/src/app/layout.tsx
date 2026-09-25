import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? "http://localhost:3000"),
  title: { default: `${BRAND.name}: ${BRAND.tagline}`, template: `%s | ${BRAND.name}` },
  description:
    "Free tools for med spas, hormone and weight-loss clinics, dental practices, and chiropractic, PT, and wellness clinics: check review replies for privacy risks and see how your clinic compares online.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">Skip to content</a>
        <header className="site-header">
          <div className="container">
            <Link className="brand" href="/">{BRAND.name}</Link>
            <nav className="nav" aria-label="Main">
              <Link href="/tools/visibility-score">Visibility Score</Link>
              <Link href="/tools/review-reply-checker">Reply Checker</Link>
              <Link href="/safe-replies">Safe replies</Link>
              <Link href="/secret-shopper">Secret Shopper</Link>
            </nav>
          </div>
        </header>
        <main id="main">{children}</main>
        <footer className="site-footer">
          <div className="container">
            <div className="links">
              <Link href="/privacy">Privacy</Link>
              <Link href="/terms">Terms</Link>
              <Link href="/safe-replies">Safe review replies</Link>
            </div>
            <p className="small">
              {BRAND.name} provides general information and automated estimates, not legal or medical advice. Scores are
              estimates based on public data.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
