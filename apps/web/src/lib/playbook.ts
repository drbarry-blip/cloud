import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadPlaybook, type Playbook } from "@cgs/core/node";

let cached: Playbook | undefined;

function playbookDir(): string {
  const candidates = [
    process.env.PLAYBOOK_DIR,
    path.resolve(process.cwd(), "playbook"),
    path.resolve(process.cwd(), "../../playbook"),
  ].filter((p): p is string => Boolean(p));
  const found = candidates.find((p) => existsSync(path.join(p, "playbook.yaml")));
  if (!found) throw new Error(`Playbook not found. Set PLAYBOOK_DIR. Looked in: ${candidates.join(", ")}`);
  return found;
}

/** The validated playbook, loaded once per server process. */
export function getPlaybook(): Playbook {
  cached ??= loadPlaybook(playbookDir());
  return cached;
}

export function clinicTypeOptions(): { id: string; name: string }[] {
  return Object.values(getPlaybook().clinicTypes).map((c) => ({ id: c.id, name: c.name }));
}
