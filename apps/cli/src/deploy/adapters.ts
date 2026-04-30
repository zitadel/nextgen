import { stat } from "node:fs/promises";
import { join } from "node:path";

import { defaultCommandRunner } from "./runner";
import type {
  CommandRunner,
  DeployAdapter,
  DeployConfigureResult,
  DeployEnvVars,
  DeployEnvironment,
  DeployPlatformId,
  DeployStatus,
  DeployState,
} from "./types";

abstract class BaseDeployAdapter implements DeployAdapter {
  abstract readonly id: DeployPlatformId;
  abstract readonly displayName: string;
  abstract readonly previewOrigins: string[];
  abstract readonly command: string;

  constructor(protected readonly runner: CommandRunner = defaultCommandRunner) {}

  abstract detect(cwd: string): Promise<boolean>;
  abstract projectLinked(cwd: string): Promise<boolean>;
  abstract configurePreviewEnv(
    cwd: string,
    vars: DeployEnvVars,
    opts?: { dryRun?: boolean },
  ): Promise<DeployConfigureResult>;
  abstract configureProductionEnv(
    cwd: string,
    vars: DeployEnvVars,
    opts?: { dryRun?: boolean },
  ): Promise<DeployConfigureResult>;

  async status(cwd: string): Promise<DeployStatus> {
    const detected = await this.detect(cwd);
    const cli = this.hasCli() ? "available" : "missing";
    const auth =
      cli === "available" ? (this.isAuthenticated(cwd) ? "authenticated" : "missing") : "unknown";
    const project = detected
      ? (await this.projectLinked(cwd))
        ? "linked"
        : "unlinked"
      : "unknown";
    const state = stateFrom({ detected, cli, auth, project });
    return {
      platform: this.id,
      detected,
      cli,
      auth,
      project,
      state,
      preview_origins: this.previewOrigins,
      manual_steps:
        state === "ready" ? [] : this.manualInstructions("preview", placeholderPreviewVars()),
    };
  }

  manualInstructions(environment: DeployEnvironment, vars: DeployEnvVars): string[] {
    const lines = Object.keys(vars).map((key) => this.manualSetCommand(environment, key));
    lines.push("Read secret values from .zitadel/secret; do not paste them into source control.");
    return lines;
  }

  protected hasCli(): boolean {
    return this.runner(this.command, ["--version"]).status === 0;
  }

  protected isAuthenticated(cwd: string): boolean {
    return this.runner(this.command, this.authArgs(), { cwd }).status === 0;
  }

  protected abstract authArgs(): string[];
  protected abstract manualSetCommand(environment: DeployEnvironment, key: string): string;
}

export class VercelDeployAdapter extends BaseDeployAdapter {
  readonly id = "vercel" as const;
  readonly displayName = "Vercel";
  readonly previewOrigins = ["*.vercel.app"];
  readonly command = "vercel";

  async detect(cwd: string): Promise<boolean> {
    return (
      (await exists(join(cwd, "vercel.json"))) || (await exists(join(cwd, ".vercel/project.json")))
    );
  }

  async projectLinked(cwd: string): Promise<boolean> {
    return exists(join(cwd, ".vercel/project.json"));
  }

  async configurePreviewEnv(cwd: string, vars: DeployEnvVars, opts: { dryRun?: boolean } = {}) {
    return this.configure(cwd, "preview", vars, opts);
  }

  async configureProductionEnv(cwd: string, vars: DeployEnvVars, opts: { dryRun?: boolean } = {}) {
    return this.configure(cwd, "production", vars, opts);
  }

  protected authArgs(): string[] {
    return ["whoami"];
  }

  protected manualSetCommand(environment: DeployEnvironment, key: string): string {
    return `vercel env add ${key} ${environment}`;
  }

  private async configure(
    cwd: string,
    environment: DeployEnvironment,
    vars: DeployEnvVars,
    opts: { dryRun?: boolean },
  ) {
    const status = await this.status(cwd);
    if (opts.dryRun || status.state !== "ready") {
      return configureResult(
        this.id,
        environment,
        false,
        status.state,
        status.state === "ready" ? [] : this.manualInstructions(environment, vars),
        vars,
      );
    }

    for (const [key, value] of Object.entries(vars)) {
      this.runner(this.command, ["env", "rm", key, environment, "--yes"], { cwd });
      const result = this.runner(this.command, ["env", "add", key, environment], {
        cwd,
        input: `${value}\n`,
      });
      if (result.status !== 0) {
        return configureResult(
          this.id,
          environment,
          false,
          "not-linked",
          this.manualInstructions(environment, vars),
          vars,
        );
      }
    }

    return configureResult(this.id, environment, true, "ready", [], vars);
  }
}

export class NetlifyDeployAdapter extends BaseDeployAdapter {
  readonly id = "netlify" as const;
  readonly displayName = "Netlify";
  readonly previewOrigins = ["*.netlify.app"];
  readonly command = "netlify";

  async detect(cwd: string): Promise<boolean> {
    return (
      (await exists(join(cwd, "netlify.toml"))) || (await exists(join(cwd, ".netlify/state.json")))
    );
  }

  async projectLinked(cwd: string): Promise<boolean> {
    return exists(join(cwd, ".netlify/state.json"));
  }

  async configurePreviewEnv(cwd: string, vars: DeployEnvVars, opts: { dryRun?: boolean } = {}) {
    return this.configure(cwd, "preview", vars, opts);
  }

  async configureProductionEnv(cwd: string, vars: DeployEnvVars, opts: { dryRun?: boolean } = {}) {
    return this.configure(cwd, "production", vars, opts);
  }

  protected authArgs(): string[] {
    return ["status", "--json"];
  }

  protected manualSetCommand(environment: DeployEnvironment, key: string): string {
    const context = environment === "preview" ? "deploy-preview" : "production";
    return `netlify env:set ${key} <value> --context ${context}`;
  }

  private async configure(
    cwd: string,
    environment: DeployEnvironment,
    vars: DeployEnvVars,
    opts: { dryRun?: boolean },
  ) {
    const status = await this.status(cwd);
    if (opts.dryRun || status.state !== "ready") {
      return configureResult(
        this.id,
        environment,
        false,
        status.state,
        status.state === "ready" ? [] : this.manualInstructions(environment, vars),
        vars,
      );
    }

    const context = environment === "preview" ? "deploy-preview" : "production";
    for (const [key, value] of Object.entries(vars)) {
      const result = this.runner(this.command, ["env:set", key, value, "--context", context], {
        cwd,
      });
      if (result.status !== 0) {
        return configureResult(
          this.id,
          environment,
          false,
          "not-linked",
          this.manualInstructions(environment, vars),
          vars,
        );
      }
    }

    return configureResult(this.id, environment, true, "ready", [], vars);
  }
}

export class CloudflareDeployAdapter extends BaseDeployAdapter {
  readonly id = "cloudflare" as const;
  readonly displayName = "Cloudflare Pages";
  readonly previewOrigins = ["*.pages.dev"];
  readonly command = "wrangler";

  async detect(cwd: string): Promise<boolean> {
    return exists(join(cwd, "wrangler.toml"));
  }

  async projectLinked(cwd: string): Promise<boolean> {
    return exists(join(cwd, "wrangler.toml"));
  }

  async configurePreviewEnv(cwd: string, vars: DeployEnvVars, opts: { dryRun?: boolean } = {}) {
    return this.configure(cwd, "preview", vars, opts);
  }

  async configureProductionEnv(cwd: string, vars: DeployEnvVars, opts: { dryRun?: boolean } = {}) {
    return this.configure(cwd, "production", vars, opts);
  }

  protected authArgs(): string[] {
    return ["whoami"];
  }

  protected manualSetCommand(_environment: DeployEnvironment, key: string): string {
    return `wrangler pages secret put ${key}`;
  }

  private async configure(
    cwd: string,
    environment: DeployEnvironment,
    vars: DeployEnvVars,
    opts: { dryRun?: boolean },
  ) {
    const status = await this.status(cwd);
    if (opts.dryRun || status.state !== "ready") {
      return configureResult(
        this.id,
        environment,
        false,
        status.state,
        status.state === "ready" ? [] : this.manualInstructions(environment, vars),
        vars,
      );
    }

    for (const [key, value] of Object.entries(vars)) {
      const result = this.runner(this.command, ["pages", "secret", "put", key], {
        cwd,
        input: `${value}\n`,
      });
      if (result.status !== 0) {
        return configureResult(
          this.id,
          environment,
          false,
          "not-linked",
          this.manualInstructions(environment, vars),
          vars,
        );
      }
    }

    return configureResult(this.id, environment, true, "ready", [], vars);
  }
}

export class NoDeployAdapter implements DeployAdapter {
  readonly id = "none" as const;
  readonly displayName = "No deploy platform";
  readonly previewOrigins: string[] = [];

  async detect(): Promise<boolean> {
    return false;
  }

  async status(): Promise<DeployStatus> {
    return {
      platform: "none",
      detected: false,
      cli: "missing",
      auth: "unknown",
      project: "unknown",
      state: "not-detected",
      preview_origins: [],
      manual_steps: [],
    };
  }

  async configurePreviewEnv() {
    return configureResult("none", "preview", false, "not-detected", [], {});
  }

  async configureProductionEnv() {
    return configureResult("none", "production", false, "not-detected", [], {});
  }

  manualInstructions(): string[] {
    return [];
  }
}

export function createDeployAdapters(
  runner: CommandRunner = defaultCommandRunner,
): DeployAdapter[] {
  return [
    new VercelDeployAdapter(runner),
    new NetlifyDeployAdapter(runner),
    new CloudflareDeployAdapter(runner),
  ];
}

function stateFrom(input: {
  detected: boolean;
  cli: "available" | "missing";
  auth: "authenticated" | "missing" | "unknown";
  project: "linked" | "unlinked" | "unknown";
}): DeployState {
  if (!input.detected) return "not-detected";
  if (input.cli === "missing") return "missing-cli";
  if (input.auth !== "authenticated") return "not-authenticated";
  if (input.project !== "linked") return "not-linked";
  return "ready";
}

function configureResult(
  platform: DeployPlatformId,
  environment: DeployEnvironment,
  configured: boolean,
  state: DeployState,
  manualSteps: string[],
  vars: DeployEnvVars,
): DeployConfigureResult {
  return {
    platform,
    environment,
    configured,
    state,
    manual_steps: manualSteps,
    variables: Object.keys(vars),
  };
}

function placeholderPreviewVars(): DeployEnvVars {
  return {
    ZITADEL_PROJECT_ID: "<project_id>",
    ZITADEL_ENVIRONMENT: "preview",
    ZITADEL_PREVIEW_SECRET: "<preview_secret>",
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}
