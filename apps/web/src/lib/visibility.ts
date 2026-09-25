import "server-only";
import { scoreVisibility, type Playbook, type VisibilityResult, type VisibilitySignals } from "@cgs/core";
import { detectWebsiteSignals, findKeyPageLinks, type PageHtml, type WebsiteSignals } from "@cgs/core/detect";
import { FetchBlockedError, fetchPublicPage, fetchRobots, robotsAllows, type FetchedPage } from "./crawl";
import { distanceMiles, getPlaceDetails, runPageSpeed, searchPlaces, type PageSpeedResult, type PlaceDetails, type PlaceSummary } from "./google";

export interface VisibilityDeps {
  getPlaceDetails: (placeId: string) => Promise<PlaceDetails>;
  searchPlaces: (query: string, near: { latitude: number; longitude: number }, radiusMeters: number) => Promise<PlaceSummary[]>;
  runPageSpeed: (url: string) => Promise<PageSpeedResult>;
  fetchPage: (url: string) => Promise<FetchedPage>;
  fetchRobots: (origin: string) => Promise<string>;
}

export function liveDeps(googleKey: string, pagespeedKey: string | undefined): VisibilityDeps {
  return {
    getPlaceDetails: (id) => getPlaceDetails(googleKey, id),
    searchPlaces: (q, near, radiusMeters) => searchPlaces(googleKey, q, { near, radiusMeters }),
    runPageSpeed: (url) => runPageSpeed(url, pagespeedKey),
    fetchPage: (url) => fetchPublicPage(url),
    fetchRobots,
  };
}

export interface CompetitorRow {
  name: string;
  rating: number | null;
  reviewCount: number;
  distanceMiles: number | null;
}

export interface VisibilityReport {
  clinic: { placeId: string; name: string; address: string; rating: number | null; reviewCount: number; websiteUri: string | null; mapsUri: string | null };
  clinicType: { id: string; name: string };
  result: VisibilityResult;
  competitors: CompetitorRow[];
  website: { status: "checked" | "none" | "unreadable" | "blocked_by_robots"; note: string | null; bookingTools: string[]; chatWidgets: string[] };
  playbookVersion: string;
  generatedAt: string;
}

const MILE_METERS = 1609.34;
const DAY_MS = 86_400_000;

async function findCompetitors(clinic: PlaceDetails, terms: string[], playbook: Playbook, deps: VisibilityDeps): Promise<CompetitorRow[]> {
  if (!clinic.location) return [];
  const { min_results, keep_top, start_radius_miles, max_radius_miles } = playbook.visibilityScore.competitors;
  const radii = [...new Set([start_radius_miles, (start_radius_miles + max_radius_miles) / 2, max_radius_miles])];
  const found = new Map<string, CompetitorRow>();
  for (const radius of radii) {
    for (const term of terms.slice(0, 2)) {
      const results = await deps.searchPlaces(term, clinic.location, radius * MILE_METERS);
      for (const p of results) {
        if (p.id === clinic.id || found.has(p.id)) continue;
        const d = p.location ? distanceMiles(clinic.location, p.location) : null;
        if (d !== null && d > radius) continue;
        found.set(p.id, { name: p.name, rating: p.rating, reviewCount: p.reviewCount, distanceMiles: d === null ? null : Math.round(d * 10) / 10 });
      }
      if (found.size >= min_results) break;
    }
    if (found.size >= min_results) break;
  }
  return [...found.values()].slice(0, keep_top);
}

type WebsiteCheck =
  | { status: "checked"; signals: WebsiteSignals }
  | { status: "none" | "unreadable" | "blocked_by_robots"; signals: null };

async function checkWebsite(websiteUri: string | null, playbook: Playbook, deps: VisibilityDeps): Promise<WebsiteCheck> {
  if (!websiteUri) return { status: "none", signals: null };
  try {
    const origin = new URL(websiteUri).origin;
    const robots = await deps.fetchRobots(origin);
    if (!robotsAllows(robots, new URL(websiteUri).pathname || "/")) return { status: "blocked_by_robots", signals: null };
    const home = await deps.fetchPage(websiteUri);
    if (home.status >= 400 || !/html/i.test(home.contentType)) return { status: "unreadable", signals: null };
    const links = findKeyPageLinks(home.url, home.body).filter((u) => robotsAllows(robots, new URL(u).pathname));
    const extra = await Promise.allSettled(links.map((u) => deps.fetchPage(u)));
    const pages: PageHtml[] = [
      { url: home.url, html: home.body },
      ...extra.flatMap((r) => (r.status === "fulfilled" && r.value.status < 400 && /html/i.test(r.value.contentType) ? [{ url: r.value.url, html: r.value.body }] : [])),
    ];
    return { status: "checked", signals: detectWebsiteSignals(pages, playbook.visibilityScore) };
  } catch (err) {
    if (!(err instanceof FetchBlockedError)) console.warn("[visibility] website check failed:", (err as Error).name);
    return { status: "unreadable", signals: null };
  }
}

const WEBSITE_NOTES: Record<Exclude<WebsiteCheck["status"], "checked">, string> = {
  none: "There's no website on this Google profile, so booking and website checks count as zero.",
  unreadable: "We couldn't load the website, so booking checks were skipped and the score was re-weighted.",
  blocked_by_robots: "The website asks automated tools not to visit, so we skipped it and re-weighted the score.",
};

export async function buildVisibilityReport(
  placeId: string,
  clinicTypeId: string,
  playbook: Playbook,
  deps: VisibilityDeps,
  now = new Date(),
): Promise<VisibilityReport> {
  const clinicType = playbook.clinicTypes[clinicTypeId];
  if (!clinicType) throw new Error(`Unknown clinic type ${clinicTypeId}`);
  const clinic = await deps.getPlaceDetails(placeId);

  const [competitors, website, speed] = await Promise.all([
    findCompetitors(clinic, clinicType.competitor_search_terms, playbook, deps),
    checkWebsite(clinic.websiteUri, playbook, deps),
    clinic.websiteUri
      ? deps.runPageSpeed(clinic.websiteUri).catch((err: Error) => {
          console.warn("[visibility] PageSpeed failed:", err.name);
          return null;
        })
      : Promise.resolve(null),
  ]);

  const w = website.signals;
  const noSite = website.status === "none";
  const signals: VisibilitySignals = {
    reputation: {
      rating: clinic.rating,
      reviewCount: clinic.reviewCount,
      competitorRatings: competitors.flatMap((c) => (c.rating === null ? [] : [c.rating])),
      competitorReviewCounts: competitors.map((c) => c.reviewCount),
      newestReviewAgeDays: clinic.newestReviewAt ? Math.max(0, (now.getTime() - clinic.newestReviewAt.getTime()) / DAY_MS) : null,
    },
    booking: noSite
      ? { onlineBooking: false, tapToCall: false, contactForm: "none", textOrChat: false, newPatientCtaAboveFold: false }
      : {
          onlineBooking: w ? w.bookingTools.length > 0 : null,
          tapToCall: w?.tapToCall ?? null,
          contactForm: w?.contactForm ?? null,
          textOrChat: w ? w.chatWidgets.length > 0 || w.textLink : null,
          newPatientCtaAboveFold: w?.newPatientCtaAboveFold ?? null,
        },
    website: {
      pagespeedMobile: speed?.performanceScore ?? null,
      coreWebVitalsPass: speed?.coreWebVitalsPass ?? null,
      labLoadSeconds: speed?.labLcpSeconds ?? null,
      https: noSite ? false : w ? w.https : clinic.websiteUri ? clinic.websiteUri.startsWith("https://") : null,
      mobileViewport: noSite ? false : (w?.mobileViewport ?? null),
    },
    profile: {
      hoursListed: clinic.hasHours,
      websiteLinked: Boolean(clinic.websiteUri),
      phoneListed: Boolean(clinic.phone),
      photoCount: clinic.photoCount,
    },
  };

  const result = scoreVisibility(signals, playbook.visibilityScore);
  if (noSite) {
    for (const pillar of result.pillars) {
      if (pillar.id !== "booking_ease" && pillar.id !== "website_speed") continue;
      for (const s of pillar.signals) if (s.measured) s.detail = "No website on the Google profile.";
    }
  }

  return {
    clinic: {
      placeId: clinic.id,
      name: clinic.name,
      address: clinic.address,
      rating: clinic.rating,
      reviewCount: clinic.reviewCount,
      websiteUri: clinic.websiteUri,
      mapsUri: clinic.mapsUri,
    },
    clinicType: { id: clinicType.id, name: clinicType.name },
    result,
    competitors,
    website: {
      status: website.status,
      note: website.status === "checked" ? null : WEBSITE_NOTES[website.status],
      bookingTools: w?.bookingTools ?? [],
      chatWidgets: w?.chatWidgets ?? [],
    },
    playbookVersion: playbook.version,
    generatedAt: now.toISOString(),
  };
}
