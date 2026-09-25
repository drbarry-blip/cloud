import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import type { z } from "zod";
import {
  FixItScriptsSchema,
  PersonaRulesSchema,
  ResponseStandardsSchema,
  RubricSchema,
  type FixItScripts,
  type PersonaRules,
  type ResponseStandards,
  type Rubric,
} from "./shopper-schema";
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
  responseStandards: ResponseStandards;
  secretShopperRubric: Rubric;
  personaRules: PersonaRules;
  fixItScripts: FixItScripts;
  // Loaded for a later phase; validated only as a YAML object for now.
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
  const personaRules = readYaml(dir, manifest.shared.persona_rules, PersonaRulesSchema);
  for (const [script, def] of Object.entries(personaRules.scripts)) {
    if (!personaRules.timing.windows[def.window]) {
      throw new PlaybookError(`${manifest.shared.persona_rules}: script "${script}" uses unknown window "${def.window}"`);
    }
  }
  const rubric = readYaml(dir, manifest.shared.secret_shopper_rubric, RubricSchema);
  const parts = rubric.parts;
  for (const part of [parts.conversation_quality, parts.reachability]) {
    const sum = part.criteria.reduce((a, c) => a + c.points, 0);
    if (sum !== part.max_points) {
      throw new PlaybookError(`${manifest.shared.secret_shopper_rubric}: criteria add up to ${sum}, but max_points is ${part.max_points}`);
    }
  }

  return {
    version: manifest.version,
    status: manifest.status,
    visibilityScore: readYaml(dir, manifest.shared.visibility_score, VisibilityScoreSchema),
    reviewReplyRules: readYaml(dir, manifest.shared.review_reply_rules, ReviewReplyRulesSchema),
    clinicTypes,
    responseStandards: readYaml(dir, manifest.shared.response_standards, ResponseStandardsSchema),
    secretShopperRubric: rubric,
    personaRules,
    fixItScripts: readYaml(dir, manifest.shared.fix_it_scripts, FixItScriptsSchema),
    locationReport: readYaml(dir, manifest.shared.location_report, LooseSchema),
  };
}
