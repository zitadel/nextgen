import type { FrameworkFacts } from "../detectors/types";
import type { CreateProjectResponse } from "../../api/client";

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
 * {@link PatchView} with the resolved project, issuer, and server it points
 * at, which fill file contents. Readonly: a patcher never mutates its input.
 *
 * Note: the user schema and flow definition are NOT here. The server
 * provisions those defaults when the project is created, so the patcher no
 * longer scaffolds them locally. The builders (`lib/user-schema`, `lib/flows`)
 * and sync engine (`lib/sync`) remain for the future pull-based workflow.
 */
export type PatchContext = PatchView &
  Readonly<{
    project: CreateProjectResponse;
    issuer: string;
    server: string;
    cliVersion: string;
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
 * Integrates Zitadel into an existing project of a specific framework. The
 * interface is execution-strategy-agnostic: a rule-based patcher applies file
 * operations, while a future LLM-based patcher would drive an agent — callers
 * only see {@link patch}/{@link repair}/{@link artifacts} and never a file-op
 * plan. `patch` performs the full integration; `repair` re-applies the managed
 * artifacts (`doctor --fix`); `artifacts` describes them for marker-aware
 * ejection.
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
}
