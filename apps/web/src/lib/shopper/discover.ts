import "server-only";
import { discoverContactRoutes, findKeyPageLinks, type ContactRoutes, type PageHtml } from "@cgs/core/detect";
import { FetchBlockedError, fetchPublicPage, fetchRobots, robotsAllows, type FetchedPage } from "../crawl";
import { getPlaybook } from "../playbook";

export interface DiscoverDeps {
  fetchPage: (url: string) => Promise<FetchedPage>;
  fetchRobots: (origin: string) => Promise<string>;
}

const liveDeps: DiscoverDeps = { fetchPage: (url) => fetchPublicPage(url), fetchRobots };

export type DiscoverResult = ContactRoutes & { status: "ok" | "blocked_by_robots" | "unreachable" };

const MAX_PAGES = 6;
const isHtml = (p: FetchedPage) => p.status === 200 && (!p.contentType || /html/i.test(p.contentType));

/**
 * Finds a clinic's contact forms and public email addresses by reading its homepage
 * and a few likely pages (contact, booking). Respects robots.txt. The owner confirms
 * the results, so a miss here just means they type it in.
 */
export async function discoverClinicContact(website: string, deps: DiscoverDeps = liveDeps): Promise<DiscoverResult> {
  const empty = (status: DiscoverResult["status"]): DiscoverResult => ({ forms: [], emails: [], status });
  let start: URL;
  try {
    start = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`);
  } catch {
    return empty("unreachable");
  }
  try {
    const robots = await deps.fetchRobots(start.origin);
    if (!robotsAllows(robots, start.pathname || "/")) return empty("blocked_by_robots");
    const home = await deps.fetchPage(start.toString());
    if (!isHtml(home)) return empty("unreachable");

    const links = findKeyPageLinks(home.url, home.body, MAX_PAGES);
    if (!links.some((u) => /contact/i.test(u))) {
      for (const path of ["/contact", "/contact-us"]) links.push(new URL(path, home.url).toString());
    }
    const allowed = [...new Set(links)].filter((u) => robotsAllows(robots, new URL(u).pathname)).slice(0, MAX_PAGES - 1);
    const fetched = await Promise.allSettled(allowed.map((u) => deps.fetchPage(u)));
    const pages: PageHtml[] = [{ url: home.url, html: home.body }];
    for (const r of fetched) if (r.status === "fulfilled" && isHtml(r.value)) pages.push({ url: r.value.url, html: r.value.body });

    return { ...discoverContactRoutes(pages, { embeddedSignatures: getPlaybook().visibilityScore.embedded_form_signatures }), status: "ok" };
  } catch (err) {
    if (!(err instanceof FetchBlockedError)) console.warn("[discover] website unreachable:", (err as Error).name);
    return empty("unreachable");
  }
}
