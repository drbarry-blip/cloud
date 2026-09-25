import type { Metadata } from "next";

export const metadata: Metadata = { title: { default: "Glow Test Clinic", template: "%s | Glow Test Clinic" }, robots: { index: false, follow: false } };

/**
 * A fictional clinic we control (SPEC.md §10.8), for running complete Secret Shopper
 * tests end to end without bothering a real clinic. Not linked from the site.
 */
export default function TestClinicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="container narrow">
      <p className="notice small" style={{ marginTop: 16 }}>
        Glow Test Clinic is fictional. It exists so we can test our own Secret Shopper. Please don&apos;t send real requests here.
      </p>
      {children}
    </div>
  );
}
