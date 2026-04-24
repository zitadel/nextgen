import type { FrameworkDetection, FrameworkId } from "../detect/framework";
import type { PackageManager } from "../detect/package-manager";
import type { ScaffoldPlan } from "../scaffolder/plan";

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
  isInitialSetup: boolean;
};

export interface FrameworkAdapter {
  readonly id: FrameworkId;
  readonly displayName: string;
  planSetup(ctx: ProjectContext): Promise<ScaffoldPlan>;
  planAddLogin(ctx: ProjectContext): Promise<ScaffoldPlan>;
  planAddRegister(ctx: ProjectContext): Promise<ScaffoldPlan>;
  sdkDependency(): { name: string; version: string };
  envKeys(): string[];
}
