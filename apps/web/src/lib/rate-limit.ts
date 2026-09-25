import "server-only";
import { createHash } from "node:crypto";
import { today } from "./http";
import type { Store } from "./store";

/** Hashes identifiers (IPs, emails) so counters never store them in the clear. */
export const hashKey = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 32);

/** Counts one use against a daily limit. Returns false once the limit is exceeded. */
export async function takeDaily(store: Store, bucket: string, identifier: string, limit: number, now = new Date()): Promise<boolean> {
  const count = await store.incrementCounter(`${bucket}:${hashKey(identifier)}`, today(now));
  return count <= limit;
}
