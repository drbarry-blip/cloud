import { z } from "zod";

// Schemas for the Secret Shopper parts of the playbook (Phase 2).

export const SCRIPTS = ["silent", "engaged", "price_check"] as const;
export type ScriptId = (typeof SCRIPTS)[number];
export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const Label = z.string().min(1);

export const ResponseStandardsSchema = z.object({
  speed_targets: z.object({
    business_hours: z.object({ first_human_response_minutes: z.number(), acceptable_minutes: z.number() }),
    after_hours: z.object({ instant_auto_reply: z.boolean(), first_human_response_minutes_after_opening: z.number() }),
  }),
  follow_up: z.object({
    window_days: z.number().int().positive(),
    minimum_human_touches: z.number().int().nonnegative(),
    minimum_distinct_days: z.number().int().positive(),
    minimum_channels: z.number().int().positive(),
  }),
  conversation: z.object({ always: z.array(z.string()), never: z.array(z.string()) }),
});
export type ResponseStandards = z.infer<typeof ResponseStandardsSchema>;

const SpeedBand = z.union([
  z.object({ label: Label, max_business_minutes: z.number(), points: z.number() }),
  z.object({ label: Label, rule: z.enum(["same_business_day", "next_business_day", "later", "never"]), points: z.number() }),
]);

const Criterion = z.object({
  id: z.string().min(1),
  points: z.number(),
  description: z.string(),
  fix: z.string(),
  applies_when: z.string().optional(),
  applies_to: z.array(z.enum(SCRIPTS)).optional(),
  good_example: z.string().optional(),
  bad_example: z.string().optional(),
});
export type Criterion = z.infer<typeof Criterion>;

export const RubricSchema = z.object({
  grades: z.object({ A: z.number(), B: z.number(), C: z.number(), D: z.number() }),
  parts: z.object({
    speed: z.object({
      max_points: z.number(),
      fix: z.string(),
      bands: z.array(SpeedBand).min(1),
      after_hours_bonus: z.object({ points: z.number(), when: z.string(), cap: z.number() }),
    }),
    persistence: z.object({
      max_points: z.number(),
      fix: z.string(),
      counted_for: z.array(z.enum(SCRIPTS)).min(1),
      bands: z.array(z.object({ label: Label, min_touches: z.number(), max_touches: z.number().nullable(), points: z.number() })).min(1),
      spread_bonus: z.object({ points: z.number(), when: z.string(), cap: z.number() }),
    }),
    conversation_quality: z.object({ max_points: z.number(), criteria: z.array(Criterion).min(1) }),
    reachability: z.object({ max_points: z.number(), criteria: z.array(Criterion).min(1) }),
  }),
  observations_not_scored: z.array(z.object({ id: z.string(), look_for: z.string() })),
});
export type Rubric = z.infer<typeof RubricSchema>;

const TimeExpr = z.string().regex(/^(?:\d{2}:\d{2}|open[+-]\d+|close[+-]\d+)$/, 'use "HH:MM", "open+N", or "close-N"');

export const WindowSchema = z.object({
  label: z.string(),
  clinic: z.enum(["open", "closed", "any"]),
  slots: z.array(z.object({ days: z.array(z.enum(WEEKDAYS)).min(1), from: TimeExpr, to: TimeExpr })).min(1),
});
export type WindowRule = z.infer<typeof WindowSchema>;

export const PersonaRulesSchema = z.object({
  never: z.array(z.string()),
  deflections: z.record(z.string(), z.string()),
  scripts: z.object({
    silent: z.object({ description: z.string(), sent_by: z.enum(["web_form", "email"]), window: z.string(), max_replies: z.number().int() }),
    engaged: z.object({ description: z.string(), sent_by: z.enum(["web_form", "email"]), window: z.string(), max_replies: z.number().int() }),
    price_check: z.object({ description: z.string(), sent_by: z.enum(["web_form", "email"]), window: z.string(), max_replies: z.number().int() }),
  }),
  test_mix: z.object({
    baseline: z.array(z.enum(SCRIPTS)).min(1),
    monthly_retest: z.object({ inquiries: z.number().int().positive(), rotate: z.string() }),
  }),
  timing: z.object({
    windows: z.record(z.string(), WindowSchema),
    min_hours_between_personas: z.number().nonnegative(),
    skip: z.array(z.string()),
    reply_delay_minutes: z.object({ min: z.number(), max: z.number() }),
    observation_days: z.number().int().positive(),
    late_days: z.number().int().nonnegative(),
    number_quarantine_days: z.number().int().nonnegative(),
  }),
  identity: z.object({ voicemail_greeting: z.string() }).loose(),
  reply_style: z.array(z.string()),
});
export type PersonaRules = z.infer<typeof PersonaRulesSchema>;

export const FixItScriptsSchema = z.object({
  call_opener: z.string(),
  voicemail: z.string(),
  text_message: z.string(),
  first_email: z.string(),
  after_hours_auto_reply: z.string(),
  price_question_reply: z.string(),
  price_objection_reply: z.string(),
  final_email: z.string(),
  cadence: z.array(z.object({ day: z.number().int().nonnegative(), when: z.string().optional(), actions: z.array(z.string()).min(1) })).min(1),
  front_desk_tips: z.array(z.string()),
});
export type FixItScripts = z.infer<typeof FixItScriptsSchema>;
