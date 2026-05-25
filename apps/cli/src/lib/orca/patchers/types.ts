import type { FrameworkDetection } from "../../../detect/framework";
import type { PackageManager } from "../../../detect/package-manager";
import type { CreateProjectResponse } from "../../../platform/schemas";
import type { ScaffoldResult } from "./legacy/file-writer/plan";

/**
 * All data required to patch an existing project with the Zitadel integration.
 * Passed by the caller (setup command) after it has resolved project, framework,
 * and user-configuration answers.
 */
export type PatchContext = {
  readonly cwd: string;
  readonly packageManager: PackageManager;
  readonly framework: FrameworkDetection;
  readonly rendererId: string;
  readonly project: CreateProjectResponse;
  readonly issuer: string;
  readonly userFields: readonly string[];
  readonly authMethods: readonly string[];
  readonly userSchema: unknown;
  readonly server: string;
  readonly devPort: number;
  readonly dryRun: boolean;
  readonly force: boolean;
};

/** A patcher integrates Zitadel into a project of a specific framework. */
export interface Patcher {
  /**
   * Returns true if this patcher supports the given framework identifier.
   * The Orca orchestrator uses this to select the appropriate patcher.
   */
  canPatch(framework: string): boolean;

  /**
   * Applies the full Zitadel integration plan to the project described by
   * the context. Produces a list of written and skipped files.
   */
  patch(ctx: PatchContext): Promise<ScaffoldResult>;
}
