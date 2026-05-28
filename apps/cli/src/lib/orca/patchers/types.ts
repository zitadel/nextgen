import type { FrameworkDetection } from "../../../detect/framework";
import type { CreateProjectResponse } from "../../../platform/client";
import type { AuthMethod } from "../../flows";
import type { UserSchema } from "../../user-schema";
import type { ScaffoldPlan } from "../file-writer/plan";

/**
 * The minimal, project-independent view a patcher needs to enumerate the files
 * it owns — just the detected framework and chosen renderer. Used by
 * {@link Patcher.artifacts} so `eject` can locate managed files without
 * reconstructing project secrets or field choices.
 */
export type PatchView = Readonly<{
  framework: FrameworkDetection;
  rendererId: string;
}>;

/**
 * Everything a patcher needs to build the full integration plan. Extends
 * {@link PatchView} with the resolved project, issuer, and schema/auth choices
 * that fill file *contents*. Readonly: a patcher never mutates its input.
 */
export type PatchContext = PatchView &
  Readonly<{
    project: CreateProjectResponse;
    issuer: string;
    userFields: ReadonlyArray<string>;
    authMethod: AuthMethod;
    userSchema: UserSchema;
    server: string;
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
 */
export type EjectActions = Readonly<{
  markedFiles: ReadonlyArray<string>;
  rootConfigFiles: ReadonlyArray<string>;
  directories: ReadonlyArray<string>;
  envBackups: ReadonlyArray<string>;
}>;

/**
 * Integrates Zitadel into an existing project of a specific framework. The
 * single source of truth for which files an integration creates: `plan`
 * produces them (consumed by `setup` and, filtered, by `doctor --fix`) and
 * `artifacts` describes them for `eject`. Both methods are pure — no
 * filesystem or network.
 */
export interface Patcher {
  /** Whether this patcher integrates the given framework id. */
  canPatch(framework: string): boolean;
  /** PURE: the complete integration plan (file operations) for the context. */
  plan(ctx: PatchContext): ScaffoldPlan;
  /** PURE: the files/dirs this patcher manages, for marker-aware ejection. */
  artifacts(view: PatchView): EjectActions;
}
