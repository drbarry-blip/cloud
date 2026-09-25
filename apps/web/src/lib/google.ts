import "server-only";

// Google Places API (New) and PageSpeed Insights.
// Google Maps Platform terms: don't store Places content (ratings, reviews, etc.)
// beyond what's allowed; place IDs may be stored. Show Google attribution
// wherever this data appears. See SPEC.md §7.2.

const PLACES = "https://places.googleapis.com/v1";

export class GoogleApiError extends Error {
  override name = "GoogleApiError";
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export interface PlaceSummary {
  id: string;
  name: string;
  address: string;
  rating: number | null;
  reviewCount: number;
  location: { latitude: number; longitude: number } | null;
}

export interface PlaceDetails extends PlaceSummary {
  websiteUri: string | null;
  phone: string | null;
  hasHours: boolean;
  photoCount: number;
  newestReviewAt: Date | null;
  mapsUri: string | null;
  businessStatus: string | null;
}

interface RawPlace {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  rating?: number;
  userRatingCount?: number;
  location?: { latitude: number; longitude: number };
  websiteUri?: string;
  nationalPhoneNumber?: string;
  regularOpeningHours?: unknown;
  photos?: unknown[];
  reviews?: { publishTime?: string }[];
  googleMapsUri?: string;
  businessStatus?: string;
}

const SUMMARY_FIELDS = ["id", "displayName", "formattedAddress", "rating", "userRatingCount", "location"];
const DETAIL_FIELDS = [...SUMMARY_FIELDS, "websiteUri", "nationalPhoneNumber", "regularOpeningHours", "photos", "reviews", "googleMapsUri", "businessStatus"];

function summary(p: RawPlace): PlaceSummary {
  return {
    id: p.id,
    name: p.displayName?.text ?? "Unnamed place",
    address: p.formattedAddress ?? "",
    rating: typeof p.rating === "number" ? p.rating : null,
    reviewCount: p.userRatingCount ?? 0,
    location: p.location ?? null,
  };
}

async function placesFetch(path: string, key: string, fieldMask: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${PLACES}${path}`, {
    ...init,
    headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": fieldMask, "Content-Type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new GoogleApiError(`Places API returned ${res.status}`, res.status);
  return res.json();
}

export async function searchPlaces(
  key: string,
  query: string,
  opts: { near?: { latitude: number; longitude: number }; radiusMeters?: number; pageSize?: number } = {},
): Promise<PlaceSummary[]> {
  const body: Record<string, unknown> = { textQuery: query, pageSize: opts.pageSize ?? 10 };
  if (opts.near) {
    body.locationBias = { circle: { center: opts.near, radius: Math.min(opts.radiusMeters ?? 8000, 50_000) } };
  }
  const data = (await placesFetch("/places:searchText", key, SUMMARY_FIELDS.map((f) => `places.${f}`).join(","), {
    method: "POST",
    body: JSON.stringify(body),
  })) as { places?: RawPlace[] };
  return (data.places ?? []).map(summary);
}

export async function getPlaceDetails(key: string, placeId: string): Promise<PlaceDetails> {
  if (!/^[A-Za-z0-9_-]{10,300}$/.test(placeId)) throw new GoogleApiError("Invalid place ID", 400);
  const p = (await placesFetch(`/places/${encodeURIComponent(placeId)}`, key, DETAIL_FIELDS.join(","))) as RawPlace;
  const times = (p.reviews ?? []).map((r) => (r.publishTime ? Date.parse(r.publishTime) : NaN)).filter((t) => !Number.isNaN(t));
  return {
    ...summary(p),
    websiteUri: p.websiteUri ?? null,
    phone: p.nationalPhoneNumber ?? null,
    hasHours: Boolean(p.regularOpeningHours),
    photoCount: p.photos?.length ?? 0,
    newestReviewAt: times.length ? new Date(Math.max(...times)) : null,
    mapsUri: p.googleMapsUri ?? null,
    businessStatus: p.businessStatus ?? null,
  };
}

/** Great-circle distance in miles. */
export function distanceMiles(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

export interface PageSpeedResult {
  performanceScore: number | null;
  coreWebVitalsPass: boolean | null;
  labLcpSeconds: number | null;
}

interface RawPageSpeed {
  lighthouseResult?: {
    categories?: { performance?: { score?: number | null } };
    audits?: Record<string, { numericValue?: number }>;
  };
  loadingExperience?: { metrics?: Record<string, { category?: string }> };
}

/** Runs Google PageSpeed Insights (mobile). Slow: often 10-40 seconds. */
export async function runPageSpeed(url: string, key: string | undefined): Promise<PageSpeedResult> {
  const params = new URLSearchParams({ url, strategy: "mobile", category: "performance" });
  if (key) params.set("key", key);
  const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new GoogleApiError(`PageSpeed returned ${res.status}`, res.status);
  const data = (await res.json()) as RawPageSpeed;
  const score = data.lighthouseResult?.categories?.performance?.score;
  const metrics = data.loadingExperience?.metrics;
  // Core Web Vitals pass when LCP, INP, and CLS are all "FAST" (good) for real visitors.
  const core = ["LARGEST_CONTENTFUL_PAINT_MS", "INTERACTION_TO_NEXT_PAINT", "CUMULATIVE_LAYOUT_SHIFT_SCORE"].map((m) => metrics?.[m]?.category);
  const lcp = data.lighthouseResult?.audits?.["largest-contentful-paint"]?.numericValue;
  return {
    performanceScore: typeof score === "number" ? score * 100 : null,
    coreWebVitalsPass: core.every((c) => c) ? core.every((c) => c === "FAST") : null,
    labLcpSeconds: typeof lcp === "number" ? lcp / 1000 : null,
  };
}
