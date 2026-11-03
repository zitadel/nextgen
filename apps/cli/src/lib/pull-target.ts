/** What a pull target names, or that it names nothing pull understands. */
export type PullTarget =
  | { readonly kind: "latest" }
  | { readonly kind: "release"; readonly id: string }
  | { readonly kind: "deployment"; readonly id: string }
  | { readonly kind: "invalid" };

/**
 * Classify a pull target: `latest` (the live release), a release id (`rel_…`),
 * a deployment id (`dep_…`), or something pull does not understand. Kept pure
 * and separate from the lookups it drives so the shape is settled before any
 * server call.
 */
export function classifyTarget(target: string): PullTarget {
  if (target === "latest") {
    return { kind: "latest" };
  }
  if (target.startsWith("rel_")) {
    return { kind: "release", id: target };
  }
  if (target.startsWith("dep_")) {
    return { kind: "deployment", id: target };
  }
  return { kind: "invalid" };
}
