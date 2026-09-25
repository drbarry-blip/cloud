import "server-only";
import {
  WEEKDAYS,
  areaCodeOrNull,
  formatDateRange,
  planPersonas,
  scheduleInquiries,
  seededRandom,
  type ClinicClock,
  type PersonaRules,
  type ScriptId,
  type WindowRule,
} from "@cgs/core";
import { createToken } from "../tokens";
import { trySend, type ShopperDeps } from "./deps";
import { testScheduledEmail } from "./emails";
import { notifyOps } from "./ops";
import type { Clinic, InquiryChannel, ShopperTest } from "./repo";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** The first inquiry goes out at least this long after scheduling, so it isn't tied to the purchase. */
const LEAD_TIME_MS = 24 * HOUR;

/**
 * Which channel and target each persona uses. Follows the playbook's `sent_by`, falls
 * back when the clinic lacks a form or an email, and spreads personas across forms.
 */
export function chooseRoutes(
  scripts: readonly ScriptId[],
  clinic: Pick<Clinic, "formUrls" | "publicEmail">,
  rules: PersonaRules,
): { channel: InquiryChannel; target: string }[] {
  const forms = clinic.formUrls;
  const email = clinic.publicEmail;
  if (forms.length === 0 && !email) throw new Error("The clinic has no contact form or public email to test");
  let formIndex = 0;
  return scripts.map((script) => {
    let channel: InquiryChannel = rules.scripts[script].sent_by;
    // With a single form, the price check goes by email so one form isn't hit twice in a row.
    if (script === "price_check" && channel === "web_form" && forms.length < 2 && email) channel = "email";
    if (channel === "web_form" && forms.length === 0) channel = "email";
    if (channel === "email" && !email) channel = "web_form";
    const target = channel === "email" ? email! : forms[formIndex++ % forms.length]!;
    return { channel, target };
  });
}

/** A looser version of a window, for clinics whose hours leave the normal window empty. */
export function relaxedWindow(window: WindowRule): WindowRule {
  return window.clinic === "closed"
    ? { label: `${window.label} (relaxed)`, clinic: "closed", slots: [{ days: [...WEEKDAYS], from: "07:00", to: "21:00" }] }
    : { label: `${window.label} (relaxed)`, clinic: window.clinic, slots: [{ days: [...WEEKDAYS], from: "open+0", to: "close-0" }] };
}

export const clinicClock = (c: Pick<Clinic, "timezone" | "hours" | "blackoutDates">): ClinicClock => ({
  timezone: c.timezone,
  hours: c.hours,
  blackoutDates: c.blackoutDates,
});

export function orderStatusUrl(siteUrl: string, orderId: string) {
  return `${siteUrl}/secret-shopper/order?t=${encodeURIComponent(createToken("order", orderId))}`;
}

/** "Oct 3–18": the dates the owner sees. The window closes after the late period. */
export function testDates(test: Pick<ShopperTest, "windowStart" | "windowEnd">, clinic: Pick<Clinic, "timezone">): string | null {
  return test.windowStart && test.windowEnd ? formatDateRange(test.windowStart, test.windowEnd, clinic.timezone) : null;
}

export type ScheduleOutcome = { ok: true; test: ShopperTest } | { ok: false; reason: string };

/**
 * Plans personas, picks send times inside the playbook's windows, reserves phone
 * numbers, and moves a verified test to "scheduled". Deterministic for a test's seed.
 */
export async function scheduleTest(deps: ShopperDeps, testId: string): Promise<ScheduleOutcome> {
  const { repo, playbook } = deps;
  const test = await repo.getTest(testId);
  if (!test || test.status !== "awaiting_verification") return { ok: false, reason: "The test isn't waiting to be scheduled." };
  const clinic = (await repo.getClinic(test.clinicId))!;
  if (clinic.verificationStatus !== "verified") return { ok: false, reason: "The clinic isn't verified yet." };
  const clinicType = playbook.clinicTypes[clinic.clinicType];
  if (!clinicType) return { ok: false, reason: `Unknown clinic type ${clinic.clinicType}` };
  const rules = playbook.personaRules;
  const random = seededRandom(test.seed);
  const now = deps.now();

  const fail = async (reason: string) => {
    await repo.transitionTest(test.id, ["awaiting_verification"], "awaiting_verification", reason);
    const task = await repo.createTask({
      type: "fix_failure",
      title: `Couldn't schedule the test for ${clinic.name}`,
      testId: test.id,
      clinicId: clinic.id,
      payload: { reason },
      dueAt: new Date(now.getTime() + DAY),
    });
    await notifyOps(deps, task, [`Clinic: ${clinic.name}`, `Reason: ${reason}`]);
    return { ok: false as const, reason };
  };

  // Retests rotate which service leads, so month to month each gets asked about.
  let serviceIds = clinic.services;
  if (test.subscriptionId && serviceIds.length > 1) {
    const k = Math.max(0, (await repo.testsForSubscription(test.subscriptionId)).findIndex((t) => t.id === test.id)) % serviceIds.length;
    serviceIds = [...serviceIds.slice(k), ...serviceIds.slice(0, k)];
  }

  let plans;
  let routes;
  try {
    plans = planPersonas(random, {
      clinicType,
      scripts: test.scripts,
      serviceIds,
      domains: deps.personaDomains(),
      takenEmails: await repo.personaEmails(),
    });
    routes = chooseRoutes(test.scripts, clinic, rules);
  } catch (err) {
    return fail((err as Error).message);
  }

  const clock = clinicClock(clinic);
  const request = (relaxed: boolean) => ({
    scripts: plans.map((p) => {
      const window = rules.timing.windows[rules.scripts[p.script].window]!;
      return { script: p.script, window: relaxed ? relaxedWindow(window) : window };
    }),
    notBefore: new Date(now.getTime() + LEAD_TIME_MS),
    minHoursBetween: rules.timing.min_hours_between_personas,
  });
  const slots = scheduleInquiries(clock, request(false), random) ?? scheduleInquiries(clock, request(true), random);
  if (!slots) return fail("No send times fit the clinic's hours in the next three weeks. Check the hours and blackout dates.");

  const lastSend = slots[slots.length - 1]!.at;
  const windowEnd = new Date(lastSend.getTime() + (rules.timing.observation_days + rules.timing.late_days) * DAY);
  const areaCode = areaCodeOrNull(clinic.phone);

  const scheduled = await repo.transaction(async (tx) => {
    for (const [i, plan] of plans.entries()) {
      const a = await tx.insertAssignment({
        testId: test.id,
        script: plan.script,
        channel: routes[i]!.channel,
        serviceId: plan.serviceId,
        serviceName: plan.serviceName,
        sensitive: plan.sensitive,
        firstName: plan.firstName,
        lastName: plan.lastName,
        sex: plan.sex,
        email: plan.email,
        phoneNumber: null,
        subject: plan.subject,
        message: plan.message,
        target: routes[i]!.target,
        scheduledAt: slots[i]!.at,
      });
      await tx.allocateNumber(a.id, areaCode, now);
    }
    await tx.setTestWindow(test.id, slots[0]!.at, windowEnd);
    const moved = await tx.transitionTest(test.id, ["awaiting_verification"], "scheduled", "Scheduled");
    if (!moved) throw new Error("The test changed while it was being scheduled");
    await tx.audit("system", "test.scheduled", { type: "test", id: test.id }, { inquiries: plans.length });
    return moved;
  });

  const order = test.orderId ? await repo.getOrder(test.orderId) : null;
  const lead = order ? await deps.store.getLead(order.leadId) : null;
  const dates = testDates(scheduled, clinic);
  if (lead && order && dates) {
    await trySend(deps, { ...testScheduledEmail({ clinicName: clinic.name, dates, statusUrl: orderStatusUrl(deps.siteUrl, order.id) }), to: lead.email }, "test scheduled");
  }
  return { ok: true, test: scheduled };
}
