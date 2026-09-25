import { afterEach, describe, expect, it, vi } from "vitest";
import { nurtureDueAt, runNurture } from "@/lib/email/nurture";
import { confirmEmail, nurtureEmail } from "@/lib/email/templates";
import { MemoryStore } from "@/lib/store/memory";

afterEach(() => vi.restoreAllMocks());

describe("nurture sequence", () => {
  it("sends each step when due, then stops after the last", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const store = new MemoryStore();
    const lead = await store.upsertLead({ email: "Owner@Clinic.example", source: "visibility_score", marketingConsent: true });
    const confirmedAt = new Date("2026-09-25T00:00:00Z");
    await store.confirmLead(lead.id, confirmedAt);
    await store.setNurture(lead.id, 0, nurtureDueAt(confirmedAt, 1));

    expect(await runNurture(store, new Date("2026-09-26T00:00:00Z"))).toEqual({ sent: 0, failed: 0 }); // day 1: nothing due
    expect(await runNurture(store, new Date("2026-09-27T01:00:00Z"))).toEqual({ sent: 1, failed: 0 }); // day 2
    expect(await runNurture(store, new Date("2026-09-30T01:00:00Z"))).toEqual({ sent: 1, failed: 0 }); // day 5
    expect(await runNurture(store, new Date("2026-10-04T01:00:00Z"))).toEqual({ sent: 1, failed: 0 }); // day 9
    expect(await runNurture(store, new Date("2026-12-01T00:00:00Z"))).toEqual({ sent: 0, failed: 0 }); // done
    expect((await store.getLead(lead.id))!.nurtureStep).toBe(3);
    expect(log.mock.calls.every(([line]) => String(line).includes("owner@clinic.example"))).toBe(true);
  });

  it("never emails unsubscribed or unconfirmed leads", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const store = new MemoryStore();
    const a = await store.upsertLead({ email: "a@example.com", source: "reply_checker", marketingConsent: true });
    await store.setNurture(a.id, 0, new Date(0)); // due, but never confirmed
    const b = await store.upsertLead({ email: "b@example.com", source: "reply_checker", marketingConsent: true });
    await store.confirmLead(b.id, new Date(0));
    await store.setNurture(b.id, 0, new Date(0));
    await store.unsubscribeLead(b.id, new Date(0));
    expect(await runNurture(store, new Date())).toEqual({ sent: 0, failed: 0 });
  });
});

describe("email templates", () => {
  it("includes the postal address placeholder, an unsubscribe link, and one-click headers on marketing email", () => {
    const email = nurtureEmail("lead-1", 1)!;
    expect(email.text).toMatch(/Unsubscribe: http.*\/unsubscribe\?t=/);
    expect(email.unsubscribeUrl).toMatch(/\/unsubscribe\?t=/);
    expect(nurtureEmail("lead-1", 4)).toBeNull();
  });

  it("escapes clinic names from Google in HTML", () => {
    const email = confirmEmail("lead-1", {
      marketingConsent: false,
      scan: { id: "s1", placeId: "p", clinicType: "dental", clinicName: "<script>alert(1)</script> Dental", total: 70, pillars: [], quickWins: [], playbookVersion: "x" },
    });
    expect(email.html).not.toContain("<script>alert(1)</script>");
    expect(email.html).toContain("&lt;script&gt;");
  });
});
