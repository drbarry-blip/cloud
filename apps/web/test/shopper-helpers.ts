import { DEFAULT_HOURS } from "@cgs/core";
import { vi } from "vitest";
import { createLiteDb } from "@/lib/db";
import type { OutgoingEmail } from "@/lib/email/mailer";
import { getPlaybook } from "@/lib/playbook";
import type { ShopperDeps } from "@/lib/shopper/deps";
import { startBaselineOrder, StartOrderSchema, type StartOrderInput } from "@/lib/shopper/purchase";
import { ShopperRepo } from "@/lib/shopper/repo";
import { SqlStore } from "@/lib/store/sql";

export const NOW = new Date("2026-10-05T15:00:00Z"); // a Monday, 10 am in Austin
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

/** Fresh deps on a new in-memory database, with a settable clock and a captured outbox. */
export async function makeDeps(over: Partial<ShopperDeps> = {}) {
  vi.spyOn(console, "info").mockImplementation(() => {});
  const db = await createLiteDb();
  const sent: OutgoingEmail[] = [];
  const clock = { now: NOW };
  const deps: ShopperDeps = {
    repo: new ShopperRepo(db),
    store: new SqlStore(db),
    playbook: getPlaybook(),
    now: () => clock.now,
    sendEmail: async (m) => {
      sent.push(m);
      return { id: `re_${sent.length}` };
    },
    stripe: null,
    personaDomains: () => ["personas.example.net"],
    siteUrl: "https://app.example",
    allowSimulatedCheckout: true,
    opsEmail: "ops@us.example",
    formBot: null,
    aiJudge: null,
    aiDraft: null,
    ...over,
  };
  return { deps, sent, repo: deps.repo, clock };
}

export function orderInput(over: { email?: string; clinic?: Partial<StartOrderInput["clinic"]> } = {}): StartOrderInput {
  return StartOrderSchema.parse({
    email: over.email ?? "owner@glowclinic.example",
    marketingConsent: false,
    clinic: {
      placeId: "ChIJglowclinic123",
      name: "Glow Clinic",
      address: "1 Main St, Austin, TX 78701, USA",
      website: "https://www.glowclinic.example/",
      phone: "(512) 555-0100",
      publicEmail: "hello@glowclinic.example",
      formUrls: ["https://www.glowclinic.example/contact"],
      clinicType: "med_spa",
      services: ["neurotoxin", "filler", "laser_hair_removal"],
      timezone: "America/Chicago",
      hours: DEFAULT_HOURS,
      blackoutDates: [],
      ...over.clinic,
    },
    authorizations: { ownsClinic: true, authorizesInquiries: true, willDeleteLeads: true },
  });
}

export const tokenFrom = (url: string) => decodeURIComponent(new URL(url).searchParams.get("t")!);
export const linkIn = (email: OutgoingEmail, path: string) => new RegExp(`https://app\\.example${path}\\?t=[^\\s]+`).exec(email.text)![0];

export async function placeOrder(deps: ShopperDeps, input = orderInput()) {
  const res = await startBaselineOrder(deps, input);
  if (!res.ok) throw new Error(res.message);
  return res;
}
