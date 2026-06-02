import type { CreateProject201, CreateSchemaBody } from "@zitadel-nextgen/api/generated/model";

import type { FrameworkFacts } from "../detectors/types";

/**
 * The minimal, project-independent view a patcher needs to enumerate the files
 * it owns — just the detected framework and chosen renderer. Used by
 * {@link Patcher.artifacts} so `eject` can locate managed files without
 * reconstructing project secrets or field choices.
 */
export type PatchView = Readonly<{
  framework: FrameworkFacts;
  rendererId: string;
}>;

/**
 * Everything a patcher needs to integrate Zitadel into a project. Extends
 * {@link PatchView} with the resolved project, issuer, and schema/auth choices
 * that fill file contents. Readonly: a patcher never mutates its input.
 */
export type PatchContext = PatchView &
  Readonly<{
    project: CreateProject201;
    issuer: string;
    userFields: ReadonlyArray<string>;
    userSchema: CreateSchemaBody;
    server: string;
  }>;

/** Where and how a patch is applied. Family-neutral (no file-op coupling). */
export type PatchExecOptions = Readonly<{
  cwd: string;
  dryRun: boolean;
  force: boolean;
}>;

/**
 * The outcome of a patch, reported in a family-neutral shape so the command
 * layer can summarize it without knowing how the patcher works (file ops vs
 * an LLM agent).
 */
export type PatchResult = Readonly<{
  dryRun: boolean;
  filesWritten: ReadonlyArray<string>;
  filesSkipped: ReadonlyArray<string>;
  depsAdded: ReadonlyArray<string>;
}>;

/**
 * The artifacts a patcher's integration owns, classified for `eject`. Freshly
 * allocated and read-only.
 *
 * - `markedFiles` — code files stamped with the managed marker; `eject` deletes
 *   one only if the on-disk file still carries the marker (so user-replaced
 *   files are preserved).
 * - `rootConfigFiles` — unmarked config files outside `.zitadel/` (e.g.
 *   `zitadel.json`); deleted unconditionally when present.
 * - `directories` — directories removed wholesale (e.g. `.zitadel`).
 * - `envBackups` — env files renamed to a timestamped backup rather than deleted.
 * - `dependencies` — package-manager dependencies the integration added.
 *   `eject` does NOT modify `package.json` (the lockfile and other deps might
 *   conflict), but surfaces an `npm uninstall <name>` line in `next_commands`
 *   so the user can finish the revert manually.
 */
export type EjectActions = Readonly<{
  markedFiles: ReadonlyArray<string>;
  rootConfigFiles: ReadonlyArray<string>;
  directories: ReadonlyArray<string>;
  envBackups: ReadonlyArray<string>;
  dependencies: ReadonlyArray<string>;
}>;

/**
 * One file the setup command surfaces in the INSTALLED section of the
 * end-of-run summary box. `path` is the project-root-relative path the
 * row points at; the row is only rendered if `path` appears in the
 * patcher's `filesWritten` (so opt-out templates that didn't write a
 * given file silently drop their row). `secondary` renders after a dim
 * `→` arrow — currently used by the "Package" row to point at
 * `package.json`.
 */
export type NarrationRow = Readonly<{
  label: string;
  path: string;
  secondary?: string;
}>;

/**
 * Pairs a written path with a short noun phrase used as the subject in
 * `"Wrote {subject} ({path})"` during the patching-phase narration.
 * Paths not listed here narrate as bare paths instead of full sentences.
 */
export type NarrationSentence = Readonly<{
  path: string;
  subject: string;
}>;

/**
 * Per-patcher data that drives the setup command's user-facing output:
 * the per-file `consola.info` lines during patching and the INSTALLED
 * section of the closing ready box. Framework-specific paths, labels,
 * and the SDK package live here so the setup command stays
 * framework-agnostic — adding Nuxt/Remix/… is implemented entirely
 * inside its patcher.
 */
export type PatcherNarration = Readonly<{
  /** The npm package the patcher adds to the project's `package.json`. */
  sdkPackage: string;
  /** INSTALLED rows in display order; setup filters to those whose `path` was actually written. */
  installedRows: ReadonlyArray<NarrationRow>;
  /** Sentence overrides for the per-file narration; unknown paths fall back to bare path. */
  sentences: ReadonlyArray<NarrationSentence>;
  /** Paths the narrator skips entirely (typically `mkdir` ops whose contents narrate separately). */
  silent: ReadonlyArray<string>;
}>;

/**
 * Integrates Zitadel into an existing project of a specific framework. The
 * interface is execution-strategy-agnostic: a rule-based patcher applies file
 * operations, while a future LLM-based patcher would drive an agent — callers
 * only see {@link patch}/{@link repair}/{@link artifacts}/{@link narration}
 * and never a file-op plan. `patch` performs the full integration; `repair`
 * re-applies the managed artifacts (`doctor --fix`); `artifacts` describes
 * them for marker-aware ejection; `narration` provides the human-readable
 * labels and sentences the setup command shows the user as it runs.
 */
export interface Patcher {
  /** Whether this patcher integrates the given framework id. */
  canPatch(framework: string): boolean;
  /** Apply the full Zitadel integration to the project. */
  patch(ctx: PatchContext, opts: PatchExecOptions): Promise<PatchResult>;
  /** Re-apply just the managed artifacts, reclaiming locally-edited ones. */
  repair(ctx: PatchContext, opts: PatchExecOptions): Promise<PatchResult>;
  /** Describe the files/dirs this integration owns, for marker-aware ejection. */
  artifacts(view: PatchView): EjectActions;
  /** Labels, paths, and sentences the setup command surfaces to the user during a run. */
  narration(view: PatchView): PatcherNarration;
}
