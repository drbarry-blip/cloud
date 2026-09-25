import { describe, expect, it } from "vitest";
import type { PlaceDetails, PlaceSummary } from "@/lib/google";
import { getPlaybook } from "@/lib/playbook";
import { buildVisibilityReport, type VisibilityDeps } from "@/lib/visibility";

const playbook = getPlaybook();
const here = { latitude: 30.2672, longitude: -97.7431 };
const now = new Date("2026-09-25T12:00:00Z");

const clinic: PlaceDetails = {
  id: "clinic_place_id_123",
  name: "Glow Med Spa",
  address: "1 Main St, Austin, TX",
  rating: 4.8,
  reviewCount: 210,
  location: here,
  websiteUri: "https://glow.example.com/",
  phone: "(512) 555-0100",
  hasHours: true,
  photoCount: 10,
  newestReviewAt: new Date("2026-09-20T12:00:00Z"),
  mapsUri: null,
  businessStatus: "OPERATIONAL",
};

const competitor = (i: number, milesNorth: number): PlaceSummary => ({
  id: `competitor_place_${i}`,
  name: `Competitor ${i}`,
  address: "",
  rating: 4.3 + i * 0.05,
  reviewCount: 40 + i * 10,
  location: { latitude: here.latitude + milesNorth / 69, longitude: here.longitude },
});

const homeHtml = `<html><head><meta name="viewport" content="width=device-width"></head><body>
<header><a href="https://www.vagaro.com/glow">Book Now</a></header><a href="tel:5125550100">Call</a><a href="/contact">Contact</a></body></html>`;

function deps(overrides: Partial<VisibilityDeps> = {}): VisibilityDeps & { searches: number[] } {
  const searches: number[] = [];
  return {
    searches,
    getPlaceDetails: async () => clinic,
    searchPlaces: async (_q, _near, radius) => {
      searches.push(Math.round(radius / 1609.34));
      // Only 2 competitors within 5 miles; 6 more within 15.
      return [competitor(1, 1), competitor(2, 3), competitor(3, 8), competitor(4, 9), competitor(5, 10), competitor(6, 12), competitor(7, 14), competitor(8, 40)];
    },
    runPageSpeed: async () => ({ performanceScore: 72, coreWebVitalsPass: true, labLcpSeconds: 2.0 }),
    fetchPage: async (url) => ({ url, status: 200, contentType: "text/html", body: url.endsWith("/contact") ? '<form><input type="text" name="name"><input type="email" name="email"><textarea name="message"></textarea></form>' : homeHtml }),
    fetchRobots: async () => "",
    ...overrides,
  };
}

describe("buildVisibilityReport", () => {
  it("scores a clinic end to end from Google, website, and PageSpeed data", async () => {
    const d = deps();
    const report = await buildVisibilityReport(clinic.id, "med_spa", playbook, d, now);
    expect(report.clinic.name).toBe("Glow Med Spa");
    expect(report.website.status).toBe("checked");
    expect(report.website.bookingTools).toEqual(["Vagaro"]);
    expect(report.result.total).toBeGreaterThan(80);
    // Widened the radius until at least 5 competitors were found, and never kept anyone beyond it.
    expect(d.searches[0]).toBe(5);
    expect(report.competitors.length).toBeGreaterThanOrEqual(5);
    expect(report.competitors.every((c) => (c.distanceMiles ?? 0) <= 25)).toBe(true);
    expect(report.competitors.some((c) => c.name === "Competitor 8")).toBe(false);
  });

  it("counts booking and website checks as zero when there's no website", async () => {
    const report = await buildVisibilityReport(clinic.id, "med_spa", playbook, deps({ getPlaceDetails: async () => ({ ...clinic, websiteUri: null }) }), now);
    expect(report.website.status).toBe("none");
    const booking = report.result.pillars.find((p) => p.id === "booking_ease")!;
    expect(booking.measured).toBe(true);
    expect(booking.score).toBe(0);
    expect(booking.signals[0]!.detail).toMatch(/No website/);
  });

  it("skips the website (and re-weights) when robots.txt says no", async () => {
    const report = await buildVisibilityReport(clinic.id, "med_spa", playbook, deps({ fetchRobots: async () => "User-agent: *\nDisallow: /" }), now);
    expect(report.website.status).toBe("blocked_by_robots");
    expect(report.result.pillars.find((p) => p.id === "booking_ease")!.measured).toBe(false);
  });

  it("still produces a score when PageSpeed and the website both fail", async () => {
    const report = await buildVisibilityReport(
      clinic.id,
      "med_spa",
      playbook,
      deps({ runPageSpeed: async () => Promise.reject(new Error("timeout")), fetchPage: async () => Promise.reject(new Error("ECONNRESET")) }),
      now,
    );
    expect(report.website.status).toBe("unreadable");
    expect(report.result.total).toBeGreaterThan(0);
  });
});
