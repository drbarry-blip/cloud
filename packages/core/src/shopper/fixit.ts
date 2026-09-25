import type { FixItScripts } from "../playbook/shopper-schema";

export interface FixItContext {
  clinicName: string;
  callbackNumber?: string;
  bookingLink?: string;
  /** The service the scripts are written for; sensitive services get generic wording. */
  service: { name: string; sensitive: boolean; priceFactor: string; smallerOption: string };
}

export interface FixItKit {
  scripts: { id: string; label: string; text: string }[];
  cadence: FixItScripts["cadence"];
  tips: string[];
}

const LABELS: Record<string, string> = {
  call_opener: "Phone call opener",
  voicemail: "Voicemail",
  text_message: "Text message",
  first_email: "First email",
  after_hours_auto_reply: "After-hours auto-reply",
  price_question_reply: "Reply to a price question",
  price_objection_reply: "Reply to a price objection",
  final_email: "Final follow-up email",
};

function shortService(name: string): string {
  const first = name.split(/\s*[/(]/)[0]!.trim();
  return name.includes("/") ? first : first.charAt(0).toLowerCase() + first.slice(1);
}

/** Fills the playbook's fix-it scripts for one clinic. Blanks the clinic must fill are left in [brackets]. */
export function renderFixItKit(scripts: FixItScripts, ctx: FixItContext): FixItKit {
  const values: Record<string, string> = {
    patient_first_name: "[first name]",
    staff_name: "[your name]",
    clinic_name: ctx.clinicName,
    callback_number: ctx.callbackNumber || "[your number]",
    booking_link: ctx.bookingLink || "[your booking link]",
    service_phrase: ctx.service.sensitive ? "your consultation request" : `your ${shortService(ctx.service.name)} question`,
    slot_1: "[day and time]",
    slot_2: "[another day and time]",
    answer_to_their_question: "[answer their question in a sentence or two]",
    price_or_range: "[price or range]",
    price_factor: ctx.service.priceFactor,
    lower_cost_option_or_payment_plan: `Some patients start with ${ctx.service.smallerOption}.`,
  };
  const fill = (template: string) => template.replace(/\{(\w+)\}/g, (m, key: string) => values[key] ?? m).trim();
  return {
    scripts: Object.keys(LABELS).map((id) => ({ id, label: LABELS[id]!, text: fill(scripts[id as keyof typeof LABELS & keyof FixItScripts] as string) })),
    cadence: scripts.cadence,
    tips: scripts.front_desk_tips,
  };
}
