import type { MetadataRoute } from "next";
import { allSafeReplyParams } from "@/lib/safe-replies";

export default function sitemap(): MetadataRoute.Sitemap {
  const site = process.env.SITE_URL ?? "http://localhost:3000";
  const pages = ["", "/tools/visibility-score", "/tools/review-reply-checker", "/secret-shopper", "/safe-replies", "/privacy", "/terms"];
  return [
    ...pages.map((p) => ({ url: `${site}${p}` })),
    ...allSafeReplyParams().map((p) => ({ url: `${site}/safe-replies/${p.clinicType}/${p.scenario}` })),
  ];
}
