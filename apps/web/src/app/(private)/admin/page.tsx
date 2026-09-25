import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { relativeTime } from "@/lib/format";
import { canSeeTask } from "@/lib/shopper/admin";
import { liveShopperDeps } from "@/lib/shopper/deps";
import { ACTIVE_TEST_STATUSES } from "@/lib/shopper/repo";
import { TASK_INFO } from "./task-info";

export const metadata = { title: "Queue" };

export default async function QueuePage() {
  const staff = await requireStaff();
  const { repo } = await liveShopperDeps();
  const now = new Date();
  const tasks = (await repo.openTasks()).filter((t) => canSeeTask(staff, t));
  const active = await repo.testsWithStatus(ACTIVE_TEST_STATUSES, 500);
  const counts = ACTIVE_TEST_STATUSES.map((s) => [s, active.filter((t) => t.status === s).length] as const);
  return (
    <div className="stack">
      <h1 style={{ margin: 0 }}>To-do</h1>
      <p className="small muted" style={{ margin: 0 }}>
        Active tests: {counts.map(([s, n]) => `${s.replace(/_/g, " ")} ${n}`).join(" · ")}
      </p>
      <div className="card">
        {tasks.length === 0 ? (
          <p style={{ margin: 0 }}>Nothing to do right now.</p>
        ) : (
          <ul className="task-list">
            {tasks.map((t) => {
              const overdue = t.dueAt && t.dueAt < now;
              return (
                <li key={t.id}>
                  <span>
                    <Link href={`/admin/tasks/${t.id}`}>{t.title}</Link>
                    <br />
                    <span className="small muted">{TASK_INFO[t.type].label}</span>
                  </span>
                  <span className={overdue ? "overdue small" : "small muted"}>{t.dueAt ? `Due ${relativeTime(t.dueAt, now)}` : "No deadline"}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
