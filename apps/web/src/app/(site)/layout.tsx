import Script from "next/script";

// Pages in this group may load privacy-friendly analytics (page views only).
// The Reply Checker lives outside this group on purpose: it gets no analytics
// at all, because people may paste sensitive text there (SPEC.md §6.6, §7.3).
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  const domain = process.env.PLAUSIBLE_DOMAIN;
  return (
    <>
      {domain ? <Script defer data-domain={domain} src="https://plausible.io/js/script.js" strategy="afterInteractive" /> : null}
      {children}
    </>
  );
}
