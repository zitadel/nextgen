import { Args } from "@oclif/core";

import { type Refusal, refusalError } from "../../../lib/oclif/refusal";

/** What a pull target names, or that it names nothing pull understands. */
export type PullTarget =
  | { readonly kind: "latest" }
  | { readonly kind: "release"; readonly id: string }
  | { readonly kind: "deployment"; readonly id: string }
  | { readonly kind: "invalid" };

/** A pull target that names something pull can read. */
export type ReadablePullTarget = Exclude<PullTarget, { readonly kind: "invalid" }>;

export const TARGET_REFUSAL: Refusal = {
  message: 'Don\'t know how to pull "{value}".',
  hint: "Pass 'latest', a release id (rel_…), or a deployment id (dep_…).",
};

/**
 * Classify a pull target: `latest` (the live release), a release id (`rel_…`),
 * a deployment id (`dep_…`), or something pull does not understand.
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

/** The live release, what is pulled when no target is given. */
export const LATEST_TARGET: ReadablePullTarget = {
  kind: "latest",
};

/** Reads what to pull, refusing a target that is not `latest`, `rel_…` or `dep_…`. */
export function readTarget(input: string): ReadablePullTarget {
  const target = classifyTarget(input);
  if (target.kind === "invalid") {
    throw refusalError(TARGET_REFUSAL, {
      value: input,
    });
  }
  return target;
}

/** What `pull` is asked to pull, handed over already classified. */
export const targetArg = Args.custom<ReadablePullTarget>({
  parse: async (input) => {
    return readTarget(input);
  },
});
