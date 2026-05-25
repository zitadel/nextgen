import type { FrameworkDetection, FrameworkId } from "../../../../detect/framework";
import type { PackageManager } from "../../../../detect/package-manager";
import type { ScaffoldPlan } from "./file-writer/plan";
import type { RendererSpec } from "./next/renderers/types";

export type ZitadelConfig = {
  project_id: string;
  issuer: string;
  preview_origins: string[];
  userSchemaPath: string;
};

export type ProjectContext = {
  cwd: string;
  packageManager: PackageManager;
  framework: FrameworkDetection;
  config: ZitadelConfig;
  renderer: RendererSpec;
  isInitialSetup: boolean;
};

export interface FrameworkAdapter {
  readonly id: FrameworkId;
  readonly displayName: string;
  /** Produces the full scaffold plan for initial project setup. */
  planSetup(ctx: ProjectContext): Promise<ScaffoldPlan>;
  /** Produces the scaffold plan for adding only the login route. */
  planAddLogin(ctx: ProjectContext): Promise<ScaffoldPlan>;
  /** Produces the scaffold plan for adding only the register route. */
  planAddRegister(ctx: ProjectContext): Promise<ScaffoldPlan>;
  /** Returns the SDK package name and version to add as a dependency. */
  sdkDependency(ctx: ProjectContext): { name: string; version: string };
  /** Returns the list of environment variable keys this adapter requires. */
  envKeys(): string[];
}
