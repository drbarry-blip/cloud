import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import type { z } from "zod";
import {
  ClinicTypeSchema,
  LooseSchema,
  ManifestSchema,
  ReviewReplyRulesSchema,
  VisibilityScoreSchema,
  type ClinicType,
  type ReviewReplyRules,
  type VisibilityScoreRules,
} from "./schema";

export interface Playbook {
  version: string;
  status: "draft" | "approved";
  visibilityScore: VisibilityScoreRules;
  reviewReplyRules: ReviewReplyRules;
  clinicTypes: Record<string, ClinicType>;
  // Loaded for later phases; validated only as YAML objects for now.
  responseStandards: Record<string, unknown>;
  secretShopperRubric: Record<string, unknown>;
  personaRules: Record<string, unknown>;
  fixItScripts: Record<string, unknown>;
  locationReport: Record<string, unknown>;
}

export class PlaybookError extends Error {
  override name = "PlaybookError";
}

function readYaml<S extends z.ZodType>(dir: string, file: string, schema: S): z.infer<S> {
  const full = path.join(dir, file);
  let raw: unknown;
  try {
    raw = parse(readFileSync(full, "utf8"));
  } catch (err) {
    throw new PlaybookError(`Could not read ${file}: ${(err as Error).message}`);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new PlaybookError(`${file} doesn't match the expected format:\n${issues}`);
  }
  return result.data;
}

/** Loads and validates the playbook from a directory containing playbook.yaml. */
export function loadPlaybook(dir: string): Playbook {
  const manifest = readYaml(dir, "playbook.yaml", ManifestSchema);
  const clinicTypes: Record<string, ClinicType> = {};
  for (const [key, file] of Object.entries(manifest.clinic_types)) {
    const clinicType = readYaml(dir, file, ClinicTypeSchema);
    if (clinicType.id !== key) {
      throw new PlaybookError(`${file}: id "${clinicType.id}" should be "${key}" to match playbook.yaml`);
    }
    const serviceIds = new Set(clinicType.services.map((s) => s.id));
    for (const inquiry of clinicType.persona_inquiries) {
      if (!serviceIds.has(inquiry.service)) {
        throw new PlaybookError(`${file}: persona inquiry uses unknown service "${inquiry.service}"`);
      }
    }
    clinicTypes[key] = clinicType;
  }
  return {
    version: manifest.version,
    status: manifest.status,
    visibilityScore: readYaml(dir, manifest.shared.visibility_score, VisibilityScoreSchema),
    reviewReplyRules: readYaml(dir, manifest.shared.review_reply_rules, ReviewReplyRulesSchema),
    clinicTypes,
    responseStandards: readYaml(dir, manifest.shared.response_standards, LooseSchema),
    secretShopperRubric: readYaml(dir, manifest.shared.secret_shopper_rubric, LooseSchema),
    personaRules: readYaml(dir, manifest.shared.persona_rules, LooseSchema),
    fixItScripts: readYaml(dir, manifest.shared.fix_it_scripts, LooseSchema),
    locationReport: readYaml(dir, manifest.shared.location_report, LooseSchema),
  };
}
