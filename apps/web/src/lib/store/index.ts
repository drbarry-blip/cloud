import "server-only";
import { config } from "../config";
import { MemoryStore } from "./memory";
import { PostgresStore } from "./postgres";
import type { Store } from "./types";

export type * from "./types";

let store: Store | undefined;

export function getStore(): Store {
  if (!store) {
    const url = config.databaseUrl();
    store = url ? PostgresStore.fromUrl(url) : new MemoryStore();
  }
  return store;
}

/** For tests. */
export function setStore(s: Store) {
  store = s;
}
