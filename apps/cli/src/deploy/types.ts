export type DeployPlatformId = "vercel" | "netlify" | "cloudflare" | "none";
export type DeployEnvironment = "preview" | "production";
export type DeployState =
  | "ready"
  | "missing-cli"
  | "not-authenticated"
  | "not-linked"
  | "not-detected";

export type DeployEnvVars = Record<string, string>;

export type CommandResult = {
  status: number;
  stdout: string;
  stderr: string;
};

export type CommandRunner = (
  command: string,
  args: string[],
  opts?: { cwd?: string; input?: string },
) => CommandResult;

export type DeployStatus = {
  platform: DeployPlatformId;
  detected: boolean;
  cli: "available" | "missing";
  auth: "authenticated" | "missing" | "unknown";
  project: "linked" | "unlinked" | "unknown";
  state: DeployState;
  preview_origins: string[];
  manual_steps: string[];
};

export type DeployConfigureResult = {
  platform: DeployPlatformId;
  environment: DeployEnvironment;
  configured: boolean;
  state: DeployState;
  manual_steps: string[];
  variables: string[];
};

export interface DeployAdapter {
  readonly id: DeployPlatformId;
  readonly displayName: string;
  readonly previewOrigins: string[];
  detect(cwd: string): Promise<boolean>;
  status(cwd: string): Promise<DeployStatus>;
  configurePreviewEnv(
    cwd: string,
    vars: DeployEnvVars,
    opts?: { dryRun?: boolean },
  ): Promise<DeployConfigureResult>;
  configureProductionEnv(
    cwd: string,
    vars: DeployEnvVars,
    opts?: { dryRun?: boolean },
  ): Promise<DeployConfigureResult>;
  manualInstructions(environment: DeployEnvironment, vars: DeployEnvVars): string[];
}
