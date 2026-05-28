import type { FrameworkDetection, FrameworkId } from "../detect/framework";
import type { PackageManager } from "../detect/package-manager";
import type { RendererSpec } from "../renderers/types";
import type { ScaffoldPlan } from "../scaffolder/plan";

/**
 * The resolved Zitadel project configuration an adapter needs to scaffold,
 * assembled from persisted config and secrets before planning. Mixes
 * snake_case (fields mirrored from the on-disk/secret format) with camelCase
 * (CLI-internal paths) deliberately to match each value's source of truth.
 */
export type ZitadelConfig = {
  project_id: string;
  issuer: string;
  preview_origins: string[];
  userSchemaPath: string;
};

/**
 * Everything an adapter's planning methods need about the target project:
 * where it lives, how to install deps, the detected framework, the resolved
 * config and chosen renderer, and whether this is a first-time setup.
 * Passed by `setup`/`doctor` into the adapter so planning stays a pure
 * function of context with no ambient I/O.
 */
export type ProjectContext = {
  cwd: string;
  packageManager: PackageManager;
  framework: FrameworkDetection;
  config: ZitadelConfig;
  renderer: RendererSpec;
  isInitialSetup: boolean;
};

/**
 * Contract every framework integration implements. Methods return
 * {@link ScaffoldPlan}s rather than performing writes so plans can be
 * previewed, diffed, and applied transactionally by the caller. Split into
 * granular `planAdd*` methods so `doctor --fix` can re-apply individual
 * pieces without re-running a full setup.
 */
export interface FrameworkAdapter {
  readonly id: FrameworkId;
  readonly displayName: string;
  planSetup(ctx: ProjectContext): Promise<ScaffoldPlan>;
  planAddLogin(ctx: ProjectContext): Promise<ScaffoldPlan>;
  planAddRegister(ctx: ProjectContext): Promise<ScaffoldPlan>;
  sdkDependency(ctx: ProjectContext): { name: string; version: string };
}
