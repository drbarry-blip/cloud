import { z } from "zod";

// Schemas for the parts of the playbook the software reads. Unknown keys are
// ignored, so the owner can add notes without breaking anything.

const Label = z.string().min(1);

export const ManifestSchema = z.object({
  version: z.string().min(1),
  status: z.enum(["draft", "approved"]),
  shared: z.object({
    response_standards: z.string(),
    secret_shopper_rubric: z.string(),
    persona_rules: z.string(),
    fix_it_scripts: z.string(),
    visibility_score: z.string(),
    review_reply_rules: z.string(),
    location_report: z.string(),
  }),
  clinic_types: z.record(z.string(), z.string()),
});

const Signature = z.object({ name: Label, domains: z.array(z.string().min(1)).min(1) });
export type Signature = z.infer<typeof Signature>;

export const VisibilityScoreSchema = z.object({
  competitors: z.object({
    min_results: z.number().int().positive(),
    keep_top: z.number().int().positive(),
    start_radius_miles: z.number().positive(),
    max_radius_miles: z.number().positive(),
  }),
  pillars: z.object({
    reputation: z.object({
      max_points: z.number(),
      signals: z.object({
        rating_vs_median: z.object({
          max_points: z.number(),
          bands: z.array(z.object({ label: Label, min_diff: z.number().nullable(), points: z.number() })).min(1),
        }),
        review_count_vs_competitors: z.object({
          max_points: z.number(),
          bands: z.array(z.object({ label: Label, min_percentile: z.number(), points: z.number() })).min(1),
          no_reviews_points: z.number(),
        }),
        newest_review_age: z.object({
          max_points: z.number(),
          bands: z.array(z.object({ label: Label, max_days: z.number().nullable(), points: z.number() })).min(1),
        }),
      }),
    }),
    booking_ease: z.object({
      max_points: z.number(),
      signals: z.object({
        online_booking_detected: z.number(),
        tap_to_call_on_mobile: z.number(),
        short_contact_form: z.number(),
        text_or_chat_option: z.number(),
        new_patient_button_above_fold: z.number(),
      }),
      short_form_max_fields: z.number().int().positive(),
    }),
    website_speed: z.object({
      max_points: z.number(),
      signals: z.object({
        pagespeed_mobile: z.object({
          max_points: z.number(),
          bands: z.array(z.object({ label: Label, min_score: z.number(), points: z.number() })).min(1),
        }),
        core_web_vitals: z.object({
          max_points: z.number(),
          pass_points: z.number(),
          no_field_data_fallback: z.object({ lab_load_seconds_max: z.number(), points: z.number() }),
        }),
        https_and_mobile_layout: z.number(),
      }),
    }),
    profile_completeness: z.object({
      max_points: z.number(),
      signals: z.object({
        hours_listed: z.number(),
        website_linked: z.number(),
        phone_listed: z.number(),
        photos_5_or_more: z.number(),
      }),
    }),
  }),
  booking_tool_signatures: z.array(Signature),
  chat_widget_signatures: z.array(Signature),
  embedded_form_signatures: z.array(Signature),
  quick_wins: z.record(z.string(), z.string()),
});
export type VisibilityScoreRules = z.infer<typeof VisibilityScoreSchema>;

export const Severity = z.enum(["unsafe", "caution", "unsafe_or_caution"]);

export const ReviewReplyRulesSchema = z.object({
  core_rule: z.string(),
  categories: z.record(
    z.string(),
    z.object({
      severity: Severity,
      explain: z.string(),
      phrases: z.array(z.string().min(1)).optional(),
      uses_clinic_type_terms: z.boolean().optional(),
    }),
  ),
  safe_templates: z.object({
    negative_general: z.string(),
    negative_wait_time: z.string(),
    negative_price: z.string(),
    negative_outcome_or_staff: z.string(),
    positive_general: z.string(),
    mixed_or_neutral: z.string(),
  }),
  rewrite_rules: z.array(z.string()),
});
export type ReviewReplyRules = z.infer<typeof ReviewReplyRulesSchema>;
export type SafeTemplateId = keyof ReviewReplyRules["safe_templates"];

export const ClinicTypeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  services: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        sensitive: z.boolean(),
        persona_sex: z.enum(["male", "female", "any"]).default("any"),
        price_factor: z.string(),
        smaller_option: z.string(),
      }),
    )
    .min(1),
  persona_inquiries: z.array(
    z.object({ service: z.string(), script: z.enum(["silent", "engaged", "price_check"]), message: z.string() }),
  ),
  follow_up_questions: z.array(z.string()),
  price_objections: z.array(z.string()),
  competitor_search_terms: z.array(z.string()).min(1),
  reply_checker_terms: z.array(z.string()),
  copy_watch_outs: z.array(z.string()),
  fix_it_notes: z.array(z.string()),
  attorney_questions: z.array(z.string()),
});
export type ClinicType = z.infer<typeof ClinicTypeSchema>;

// Parts not used by Phase 1 code are loaded loosely; Phase 2 will tighten them.
export const LooseSchema = z.record(z.string(), z.unknown());
