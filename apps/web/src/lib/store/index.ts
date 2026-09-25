import "server-only";
import { getDb } from "../db";
import { SqlStore } from "./sql";
import type { Store } from "./types";

export type * from "./types";

let store: Store | undefined;

/** Phase 1 store on the app database (Postgres in production, PGlite locally). */
export async function getStore(): Promise<Store> {
  store ??= new SqlStore(await getDb());
  return store;
}

/** For tests. */
export function setStore(s: Store) {
  store = s;
}
