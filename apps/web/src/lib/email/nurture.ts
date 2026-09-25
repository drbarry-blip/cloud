import "server-only";
import type { Store } from "../store";
import { sendEmail } from "./mailer";
import { NURTURE_DAYS, nurtureEmail } from "./templates";

const DAY_MS = 24 * 60 * 60 * 1000;

/** When the given 1-based step is due, counted from confirmation. */
export function nurtureDueAt(confirmedAt: Date, step: number): Date | null {
  const days = NURTURE_DAYS[step - 1];
  return days === undefined ? null : new Date(confirmedAt.getTime() + days * DAY_MS);
}

/** Sends every nurture email that's due. Safe to run repeatedly (e.g., hourly from a scheduler). */
export async function runNurture(store: Store, now = new Date(), batch = 200): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const lead of await store.dueNurture(now, batch)) {
    const step = lead.nurtureStep + 1;
    const email = nurtureEmail(lead.id, step);
    if (!email || !lead.confirmedAt) {
      await store.setNurture(lead.id, lead.nurtureStep, null);
      continue;
    }
    try {
      await sendEmail({ ...email, to: lead.email });
      await store.setNurture(lead.id, step, nurtureDueAt(lead.confirmedAt, step + 1));
      sent++;
    } catch (err) {
      failed++;
      console.error("[nurture] send failed:", (err as Error).message);
    }
  }
  return { sent, failed };
}
