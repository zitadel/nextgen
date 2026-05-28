/**
 * Identifies which hosting platform a deploy adapter targets. `"none"` is the
 * sentinel used when no platform is detected or requested, so callers can
 * always work with a concrete adapter rather than `undefined`.
 */
export type DeployPlatformId = "vercel" | "netlify" | "cloudflare" | "none";

/**
 * The two deployment contexts the CLI configures secrets for. Preview maps to
 * per-branch/PR deployments; production maps to the live site.
 */
export type DeployEnvironment = "preview" | "production";

/**
 * Coarse readiness of a platform integration, derived from detection, CLI
 * availability, authentication, and project linking. Only `"ready"` permits
 * automated configuration; every other value drives manual fallback steps.
 */
export type DeployState =
  | "ready"
  | "missing-cli"
  | "not-authenticated"
  | "not-linked"
  | "not-detected";

/**
 * Environment variables to push to a platform, keyed by variable name. Values
 * are secret material and must never be logged or echoed.
 */
export type DeployEnvVars = Record<string, string>;

/**
 * Outcome of a single external CLI invocation. `status` is normalized so a
 * missing exit code is treated as failure (non-zero) by consumers.
 */
export type CommandResult = {
  status: number;
  stdout: string;
  stderr: string;
};

/**
 * Abstraction over running an external platform CLI. Injected into adapters so
 * tests can stub command behavior without spawning real processes.
 */
export type CommandRunner = (
  command: string,
  args: string[],
  opts?: { cwd?: string; input?: string },
) => CommandResult;

/**
 * Snapshot of a platform integration's health, surfaced by `doctor` and used
 * to decide whether automated env configuration can proceed.
 */
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

/**
 * Result of attempting to configure env vars for one environment. `configured`
 * reports whether the platform was actually updated; when false, `manual_steps`
 * tells the user how to finish by hand. `variables` lists only the names that
 * were targeted so secret values never leak into output.
 */
export type DeployConfigureResult = {
  platform: DeployPlatformId;
  environment: DeployEnvironment;
  configured: boolean;
  state: DeployState;
  manual_steps: string[];
  variables: string[];
};

/**
 * Common contract every hosting-platform integration implements so the deploy
 * flow can treat Vercel, Netlify, Cloudflare, and the no-op target uniformly.
 */
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
