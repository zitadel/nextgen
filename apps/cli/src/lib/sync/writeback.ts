import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { consola } from "consola";

import { stableStringify } from "../json";

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

/**
 * Write a resource's canonical body back to its file when it materially
 * differs from what is on disk.
 *
 * The written form is the `normalizeWrite` form (strips pure transport noise
 * like the empty `audience` echo; for schemas the canonical body verbatim —
 * spelled-out x-* defaults must survive, or the next publish would drop them).
 * Equality is judged in the `normalize` comparison form, so the file is
 * rewritten only when it materially differs; hand-formatted files stay
 * untouched otherwise. Returns the state hash of the written form.
 */
export async function writeBackResource(
  cwd: string,
  relPath: string,
  syncer: Normalizer,
  canonical: object,
): Promise<{ hash: string; changed: boolean }> {
  let writeBody = syncer.normalizeWrite?.(canonical) ?? canonical;
  const compare = (body: object) => stableStringify(syncer.normalize?.(body) ?? body);
  const absPath = join(cwd, relPath);
  let changed = true;
  try {
    const onDisk = JSON.parse(await readFile(absPath, "utf8")) as Record<string, unknown>;
    changed = compare(writeBody) !== compare(onDisk);
    // `$schema` is a local editor affordance (points at the dialect spec in
    // .zitadel/meta/); the server never echoes it, so a rewrite would drop it.
    // Carry the on-disk pointer over unless the canonical body has its own
    // (user-schema documents do).
    if (typeof onDisk.$schema === "string" && !("$schema" in writeBody)) {
      writeBody = { ...writeBody, $schema: onDisk.$schema };
    }
  } catch (err) {
    consola.debug(`read ${relPath} for write-back failed:`, err);
  }
  if (changed) {
    await writeFile(absPath, `${stableStringify(writeBody)}\n`);
  }
  return { hash: hashForState(syncer, writeBody), changed };
}
