import { json } from "@/lib/http";
import { getPlaybook } from "@/lib/playbook";

export function GET() {
  return json({ ok: true, playbookVersion: getPlaybook().version });
}
