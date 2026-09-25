import { ActionButton } from "@/components/ActionButton";
import { requireStaff } from "@/lib/auth";
import { formatDate, formatPhone } from "@/lib/format";
import { liveShopperDeps } from "@/lib/shopper/deps";
import { NumberForm } from "./NumberForm";

export const metadata = { title: "Numbers" };

export default async function NumbersPage() {
  await requireStaff("admin");
  const { repo } = await liveShopperDeps();
  const numbers = await repo.listNumbers();
  const now = new Date();
  const free = numbers.filter((n) => n.status === "available" || (n.status === "quarantined" && n.availableAfter && n.availableAfter <= now)).length;
  return (
    <div className="stack">
      <h1 style={{ margin: 0 }}>Persona phone numbers</h1>
      <p className="muted" style={{ margin: 0 }}>
        {free} free of {numbers.length}. Buy local numbers in Twilio, point their voice and messaging webhooks at this site, then add them here. Each test uses up to three; numbers rest 30 days between tests.
      </p>
      <div className="card">
        <NumberForm />
      </div>
      <div className="card">
        <ul className="task-list">
          {numbers.map((n) => (
            <li key={n.e164}>
              <span>
                <strong>{formatPhone(n.e164)}</strong> <span className="small muted">area {n.areaCode}</span>
              </span>
              <span className="small">
                {n.status}
                {n.status === "quarantined" && n.availableAfter ? ` until ${formatDate(n.availableAfter)}` : ""}{" "}
                {n.status !== "retired" && n.status !== "assigned" ? <ActionButton endpoint="/api/admin/numbers" body={{ action: "retire", e164: n.e164 }} label="Retire" confirm="Retire this number? It won't be used again." /> : null}
              </span>
            </li>
          ))}
          {numbers.length === 0 ? <li className="muted">No numbers yet. Without numbers, personas leave phone fields blank where they're optional.</li> : null}
        </ul>
      </div>
    </div>
  );
}
