import "server-only";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { config } from "./config";

/**
 * One SQL interface over two engines: real Postgres (production, via DATABASE_URL)
 * and PGlite, an in-process Postgres used for local development and tests. The app
 * runs the same SQL on both, so tests exercise the real queries and migrations.
 */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<void>;
  /** Runs `fn` in a transaction. The callback must use the `tx` it's given. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

class PgDb implements Db {
  constructor(private pool: pg.Pool) {}
  async query<T>(sql: string, params: unknown[] = []) {
    const r = await this.pool.query(sql, params);
    return { rows: r.rows as T[] };
  }
  async exec(sql: string) {
    await this.pool.query(sql);
  }
  async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const tx: Db = {
      query: async <R>(sql: string, params: unknown[] = []) => ({ rows: (await client.query(sql, params)).rows as R[] }),
      exec: async (sql: string) => void (await client.query(sql)),
      transaction: (inner) => inner(tx),
      close: async () => {},
    };
    try {
      await client.query("BEGIN");
      const out = await fn(tx);
      await client.query("COMMIT");
      return out;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
  async close() {
    await this.pool.end();
  }
}

type PGliteLike = {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
  transaction<T>(fn: (tx: { query<R>(sql: string, params?: unknown[]): Promise<{ rows: R[] }>; exec(sql: string): Promise<unknown> }) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

class LiteDb implements Db {
  constructor(private lite: PGliteLike) {}
  async query<T>(sql: string, params: unknown[] = []) {
    const r = await this.lite.query<T>(sql, params);
    return { rows: r.rows };
  }
  async exec(sql: string) {
    await this.lite.exec(sql);
  }
  async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return this.lite.transaction(async (t) => {
      const tx: Db = {
        query: async <R>(sql: string, params: unknown[] = []) => ({ rows: (await t.query<R>(sql, params)).rows }),
        exec: async (sql: string) => void (await t.exec(sql)),
        transaction: (inner) => inner(tx),
        close: async () => {},
      };
      return fn(tx);
    });
  }
  async close() {
    await this.lite.close();
  }
}

export function migrationsDir(): string {
  const candidates = [process.env.MIGRATIONS_DIR, path.resolve(process.cwd(), "migrations"), path.resolve(process.cwd(), "apps/web/migrations")].filter(
    (p): p is string => Boolean(p),
  );
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error(`Migrations not found. Set MIGRATIONS_DIR. Looked in: ${candidates.join(", ")}`);
  return found;
}

/** Applies each SQL file in the migrations folder once, in order. */
export async function migrate(db: Db, dir = migrationsDir()): Promise<string[]> {
  await db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
  const { rows } = await db.query<{ name: string }>("SELECT name FROM schema_migrations");
  const applied = new Set(rows.map((r) => r.name));
  const ran: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (applied.has(file)) continue;
    const sql = readFileSync(path.join(dir, file), "utf8");
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
    });
    ran.push(file);
  }
  return ran;
}

/** A fresh in-process database with all migrations applied (tests and local development). */
export async function createLiteDb(dataDir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const lite = new PGlite(dataDir);
  await lite.waitReady;
  const db = new LiteDb(lite as unknown as PGliteLike);
  await migrate(db);
  return db;
}

let dbPromise: Promise<Db> | undefined;

/**
 * The app's database. Production uses DATABASE_URL (run `npm run migrate` on deploy).
 * Without it, an in-process PGlite database is used and migrated automatically;
 * set PGLITE_DIR to keep its data between restarts.
 */
export function getDb(): Promise<Db> {
  dbPromise ??= (async () => {
    const url = config.databaseUrl();
    if (url) return new PgDb(new pg.Pool({ connectionString: url, max: 5 }));
    return createLiteDb(process.env.PGLITE_DIR || undefined);
  })();
  return dbPromise;
}

/** For tests. */
export function setDb(db: Db) {
  dbPromise = Promise.resolve(db);
}

export const asBytes = (v: unknown): Uint8Array => (v instanceof Uint8Array ? v : new Uint8Array(v as ArrayBuffer));
