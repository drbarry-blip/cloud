import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const site = process.env.SITE_URL ?? "http://localhost:3000";
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/confirm", "/unsubscribe", "/admin", "/account", "/report/", "/secret-shopper/order", "/secret-shopper/confirm", "/secret-shopper/dev-checkout"] }],
    sitemap: `${site}/sitemap.xml`,
  };
}
