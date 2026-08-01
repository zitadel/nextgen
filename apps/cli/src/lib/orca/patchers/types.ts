import type { FrameworkFacts } from "../detectors/types";
import type { CreateProjectResponse } from "../../api/client";
import type { ScaffoldFileClass } from "../../sync/types";

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
 * Note: the user schema and flow definition are NOT here. Setup scaffolds and
 * uploads those editable resource files after the patcher has created the base
 * `.zitadel/` directories and sync state.
 */
export type PatchContext = PatchView &
  Readonly<{
    project: CreateProjectResponse;
    issuer: string;
    server: string;
    cliVersion: string;
    scaffoldedFramework?: boolean;
    /**
     * Sign-in preset the scaffold starts from (`SETUP_PRESETS` in
     * @zitadel/config). Recorded in `zitadel.json` so later tooling knows
     * the project's starting point; absent means password-first.
     */
    preset?: string;
    /**
     * Use case the scaffold starts from (`SETUP_USE_CASES` in @zitadel/config).
     * Recorded in `zitadel.json` for guidance/status only — behavior comes
     * entirely from the generated schema/flow files, never from this value.
     * Absent means minimal.
     */
    useCase?: string;
  }>;

/** Where and how a patch is applied. Family-neutral (no file-op coupling). */
export type PatchExecOptions = Readonly<{
  cwd: string;
  dryRun: boolean;
  force: boolean;
  /**
   * Restrict the run to artifacts whose target file does not exist yet.
   * `doctor --fix` sets this so a repair can only ever restore missing
   * managed files — never overwrite an edited or user-adopted one.
   * Additive ops (env merges, gitignore entries, dependency additions)
   * still apply; they are idempotent by construction.
   */
  missingOnly?: boolean;
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
 * - `configEdits` — user config files the integration merged into via an `edit`
 *   op (e.g. `vite.config.ts`, `angular.json`, `nuxt.config.ts`). `eject` cannot
 *   reverse an in-place merge, so it surfaces these as manual cleanup steps
 *   rather than deleting the whole file.
 * - `guidanceFiles` — user-owned docs (`README.md`, `AGENTS.md`) carrying a
 *   marker-fenced managed guidance section. `eject` strips just the section
 *   (content outside the markers is preserved); the whole file is deleted only
 *   when nothing but the scaffold-created header would remain.
 * - `fileClasses` — ownership class per marked file for the `doctor`
 *   managed-files check: `infrastructure` files are load-bearing (missing ⇒
 *   fail), everything else is `presentation` (missing ⇒ warn). Optional so
 *   older/simpler patchers stay compile-compatible; absent means every marked
 *   file is presentation.
 * - `conditionalFiles` — marked files only written on some scaffolds (e.g. the
 *   framework home page, written only when setup created the app skeleton).
 *   The managed-files check excludes them when no scaffold manifest recorded
 *   what was actually written.
 */
export type EjectActions = Readonly<{
  markedFiles: ReadonlyArray<string>;
  rootConfigFiles: ReadonlyArray<string>;
  directories: ReadonlyArray<string>;
  envBackups: ReadonlyArray<string>;
  dependencies: ReadonlyArray<string>;
  configEdits: ReadonlyArray<string>;
  guidanceFiles: ReadonlyArray<string>;
  fileClasses?: Readonly<Record<string, ScaffoldFileClass>>;
  conditionalFiles?: ReadonlyArray<string>;
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
  /**
   * Re-apply just the managed artifacts. With `opts.missingOnly` (the
   * `doctor --fix` path) only missing files are restored; existing files —
   * edited or user-adopted — are never overwritten.
   */
  repair(ctx: PatchContext, opts: PatchExecOptions): Promise<PatchResult>;
  /** Describe the files/dirs this integration owns, for marker-aware ejection. */
  artifacts(view: PatchView): EjectActions;
}
