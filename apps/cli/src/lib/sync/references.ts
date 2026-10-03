/**
 * Cross-resource reference rewriting for `pull`.
 *
 * A server response carries concrete revision ids in its references: a flow's
 * `user_schema` holds a `sch_…` id. Locally those must be handles, so a pulled
 * file joins its dependencies by name and the release constructor resolves them
 * against whatever revision a release pins — rather than freezing a stale
 * revision id into the repository.
 *
 * This resolver is kind-agnostic. It reads each syncer's declared
 * {@link ResourceSyncer.references} and resolves each one through the target
 * syncer's own `fetch` + `handleField` + `idPrefix`. Adding a reference between
 * two kinds is therefore a row on a syncer, never a change here. A referenced
 * revision that no longer exists leaves the id in place and records a warning,
 * so a pull degrades rather than fails — the same posture `plan`/`apply` take
 * toward a reference they cannot resolve.
 */
import { ApiError } from "@zitadel/api/runtime/fetch";

import type { ResourceSyncer } from "./types";

export interface RefRewriteResult {
  /** The body with every resolvable id reference replaced by a handle. */
  readonly body: object;
  /** One line per reference left as an id because its target was gone. */
  readonly warnings: ReadonlyArray<string>;
}

/**
 * Rewrite every cross-resource id reference in a freshly fetched `body` of
 * `kind` to the referenced resource's handle.
 *
 * `syncers` is the full registry ({@link makeSyncers}); the referenced kind is
 * resolved against it, so the resolver reaches a schema while rewriting a flow
 * without either kind being named here.
 */
export async function rewriteRefsToHandles(
  kind: string,
  body: object,
  syncers: ReadonlyArray<ResourceSyncer>,
): Promise<RefRewriteResult> {
  const references = syncers.find((syncer) => syncer.kind === kind)?.references ?? [];
  if (references.length === 0) {
    return { body, warnings: [] };
  }

  const next = structuredClone(body) as Record<string, unknown>;
  const warnings: string[] = [];
  for (const reference of references) {
    const id = readPath(next, reference.path);
    if (typeof id !== "string") {
      continue;
    }
    const target = syncers.find((syncer) => syncer.kind === reference.kind);
    // A kind that cannot be fetched or has no handle cannot be resolved; a
    // value that is not a concrete id (a URL, a `${VAR}`, an already-rewritten
    // handle) is left exactly as the server stated it.
    if (!target?.fetch || target.handleField === undefined) {
      continue;
    }
    if (target.idPrefix !== undefined && !id.startsWith(`${target.idPrefix}_`)) {
      continue;
    }
    try {
      const document = (await target.fetch(id)) as Record<string, unknown>;
      const handle = document[target.handleField];
      if (typeof handle === "string") {
        writePath(next, reference.path, handle);
      }
    } catch (error) {
      // A deleted revision is the one expected miss: keep the id so the file
      // still round-trips, and warn. Anything else is a real failure.
      if (error instanceof ApiError && error.status === 404) {
        warnings.push(
          `${reference.kind} ${id} no longer exists; wrote the id as-is in ${reference.path}.`,
        );
        continue;
      }
      throw error;
    }
  }
  return { body: next, warnings };
}

/** Read a dot-path (`a.b.c`) out of a nested object, or undefined if absent. */
function readPath(root: Record<string, unknown>, path: string): unknown {
  let node: unknown = root;
  for (const key of path.split(".")) {
    if (node === null || typeof node !== "object") {
      return undefined;
    }
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

/** Write a value at a dot-path, assuming every parent already exists (a read found the leaf). */
function writePath(root: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  const leaf = keys.pop() as string;
  let node: Record<string, unknown> = root;
  for (const key of keys) {
    node = node[key] as Record<string, unknown>;
  }
  node[leaf] = value;
}
