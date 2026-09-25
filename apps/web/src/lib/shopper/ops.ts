import "server-only";
import { trySend, type ShopperDeps } from "./deps";
import { opsAlertEmail } from "./emails";
import type { OpsTask } from "./repo";

/** Tells the ops inbox about a new task. Lines must never include message bodies or PHI. */
export async function notifyOps(deps: ShopperDeps, task: OpsTask, lines: string[]): Promise<void> {
  const url = `${deps.siteUrl}/admin/tasks/${task.id}`;
  if (!deps.opsEmail) {
    console.info(`[ops] ${task.title} (${task.type}) ${url}`);
    return;
  }
  await trySend(deps, { ...opsAlertEmail({ title: task.title, lines, url }), to: deps.opsEmail }, "ops alert");
}
