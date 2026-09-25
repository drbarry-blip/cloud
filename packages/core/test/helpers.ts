import { fileURLToPath } from "node:url";
import { loadPlaybook } from "../src/node";

export const PLAYBOOK_DIR = fileURLToPath(new URL("../../../playbook", import.meta.url));
export const playbook = loadPlaybook(PLAYBOOK_DIR);
export const allClinicTerms = Object.values(playbook.clinicTypes).flatMap((c) => c.reply_checker_terms);
