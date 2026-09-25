import { describe, expect, it } from "vitest";
import { createLiteDb, migrate } from "@/lib/db";
import { SqlStore } from "@/lib/store/sql";

describe("database", () => {
  it("applies every migration once, and re-running is a no-op", async () => {
    const db = await createLiteDb();
    const { rows } = await db.query<{ name: string }>("SELECT name FROM schema_migrations ORDER BY name");
    expect(rows.map((r) => r.name)).toEqual(["001_init.sql", "002_shopper.sql"]);
    expect(await migrate(db)).toEqual([]);
  });

  it("upserts leads by normalized email and merges sources and consent", async () => {
    const store = new SqlStore(await createLiteDb());
    const a = await store.upsertLead({ email: "Owner@Clinic.Example ", source: "reply_checker", marketingConsent: false });
    const b = await store.upsertLead({ email: "owner@clinic.example", source: "visibility_score", marketingConsent: true });
    expect(b.id).toBe(a.id);
    expect(b.sources).toEqual(["reply_checker", "visibility_score"]);
    expect(b.marketingConsent).toBe(true);
  });

  it("counts daily usage atomically", async () => {
    const store = new SqlStore(await createLiteDb());
    const counts = await Promise.all([1, 2, 3].map(() => store.incrementCounter("k", "2026-09-25")));
    expect(counts.sort()).toEqual([1, 2, 3]);
  });

  it("rolls back a failed transaction", async () => {
    const db = await createLiteDb();
    await expect(
      db.transaction(async (tx) => {
        await tx.query("INSERT INTO leads (email) VALUES ($1)", ["a@example.com"]);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const { rows } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM leads");
    expect(rows[0]!.n).toBe(0);
  });
});
