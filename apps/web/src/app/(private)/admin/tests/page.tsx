import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { liveShopperDeps } from "@/lib/shopper/deps";
import type { TestStatus } from "@/lib/shopper/repo";
import { testDates } from "@/lib/shopper/schedule";

export const metadata = { title: "Tests" };

const GROUPS: { label: string; statuses: TestStatus[] }[] = [
  { label: "Needs attention", statuses: ["awaiting_verification", "qa", "failed"] },
  { label: "Running", statuses: ["scheduled", "running", "grading"] },
  { label: "Delivered", statuses: ["delivered"] },
  { label: "Unpaid or cancelled", statuses: ["awaiting_payment", "cancelled"] },
];

export default async function TestsPage() {
  await requireStaff();
  const { repo } = await liveShopperDeps();
  return (
    <div className="stack">
      <h1 style={{ margin: 0 }}>Tests</h1>
      {await Promise.all(
        GROUPS.map(async (g) => {
          const tests = await repo.testsWithStatus(g.statuses, 200);
          const rows = await Promise.all(tests.map(async (t) => ({ t, clinic: (await repo.getClinic(t.clinicId))! })));
          return (
            <div className="card" key={g.label}>
              <h2 style={{ marginTop: 0 }}>
                {g.label} ({tests.length})
              </h2>
              {rows.length ? (
                <ul className="task-list">
                  {rows.map(({ t, clinic }) => (
                    <li key={t.id}>
                      <Link href={`/admin/tests/${t.id}`}>{clinic.name}</Link>
                      <span className="small muted">
                        {t.kind} · {t.status.replace(/_/g, " ")} · {testDates(t, clinic) ?? "not scheduled"}
                        {t.grade ? ` · ${t.grade} (${t.score})` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted" style={{ margin: 0 }}>None.</p>
              )}
            </div>
          );
        }),
      )}
    </div>
  );
}
