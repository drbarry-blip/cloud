import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadPlaybook, PlaybookError } from "../src/node";
import { PLAYBOOK_DIR, playbook } from "./helpers";

describe("loadPlaybook", () => {
  it("loads the real playbook with all four clinic types", () => {
    expect(playbook.version).toMatch(/\d+\.\d+\.\d+/);
    expect(Object.keys(playbook.clinicTypes).sort()).toEqual([
      "chiro_pt_wellness",
      "dental",
      "hormone_weight_loss",
      "med_spa",
    ]);
  });

  it("has Visibility Score pillars that add up to 100", () => {
    const p = playbook.visibilityScore.pillars;
    const total = p.reputation.max_points + p.booking_ease.max_points + p.website_speed.max_points + p.profile_completeness.max_points;
    expect(total).toBe(100);
  });

  it("has a quick win for every scored signal", () => {
    const p = playbook.visibilityScore.pillars;
    const ids = [
      ...Object.keys(p.reputation.signals),
      ...Object.keys(p.booking_ease.signals),
      ...Object.keys(p.website_speed.signals),
      ...Object.keys(p.profile_completeness.signals),
    ];
    for (const id of ids) expect(playbook.visibilityScore.quick_wins[id], id).toBeTruthy();
  });

  it("names the file and field when an edit breaks the format", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "playbook-"));
    cpSync(PLAYBOOK_DIR, dir, { recursive: true });
    const file = path.join(dir, "shared/visibility-score.yaml");
    writeFileSync(file, readFileSync(file, "utf8").replace("min_results: 5", 'min_results: "five"'));
    expect(() => loadPlaybook(dir)).toThrow(PlaybookError);
    expect(() => loadPlaybook(dir)).toThrow(/visibility-score\.yaml[\s\S]*competitors\.min_results/);
  });
});
