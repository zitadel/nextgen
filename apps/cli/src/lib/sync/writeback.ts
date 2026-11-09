import { createHash } from "node:crypto";


import { stableStringify } from "@/lib/json";

/**
 * The two reductions write-back needs from a resource. `normalize` is the
 * comparison form (so a reformatted file is not rewritten); `normalizeWrite` is
 * the form written to disk (transport noise stripped, meaning preserved).
 */
type Normalizer = {
  normalize?(data: object): object;
  normalizeWrite?(data: object): object;
};

/**
 * The hashing and write-back helpers scaffolding still needs after the sync
 * loop was removed: `setup-resources.ts` hashes a materialised resource and
 * writes the server's canonical body back to disk. These are the pure pieces of
 * the old loop — no diffing, no platform calls — kept because setup, not deploy,
 * is what writes a project's files.
 */

/**
 * The content hash stored in `.zitadel/state.json`: key-order-insensitive (via
 * `stableStringify`) and computed on the syncer's normalized form, so
 * reordering keys or spelling out a meta-schema default does not read as an
 * edit.
 */
export function hashForState(syncer: Pick<Normalizer, "normalize">, data: object): string {
  const normalized = syncer.normalize?.(data) ?? data;
  return createHash("sha256").update(stableStringify(normalized)).digest("hex");
}

