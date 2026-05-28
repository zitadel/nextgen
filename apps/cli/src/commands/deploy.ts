import { detectDeployTarget } from "../deploy";
import type { DeployEnvVars } from "../deploy";
import type { CliIO, GlobalOptions } from "../io/output";
import { ok } from "../io/output";
import { ZitadelError } from "../lib/errors";
import { isObject } from "../lib/json";
import { readZitadelConfig, readZitadelSecret } from "./shared";

/**
 * Options shared by the deploy subcommands. `platform` pins which deploy
 * adapter to use (otherwise it is auto-detected); `environment` selects
 * preview vs production wiring; `manual` forces emission of manual setup
 * steps instead of configuring the platform; `silent` suppresses the
 * success payload when invoked as a sub-step of `setup`.
 */
export type DeployOptions = GlobalOptions & {
  platform?: string;
  environment?: string;
  manual?: boolean;
  silent?: boolean;
};

/**
 * Reports the current deploy-platform status by detecting the target adapter
 * and querying its state. Read-only; never mutates platform configuration.
 */
export async function runDeployStatus(io: CliIO, opts: DeployOptions): Promise<void> {
  const adapter = await detectDeployTarget(opts.cwd, opts.platform);
  ok(io, await adapter.status(opts.cwd), opts);
}

/**
 * Wires the deploy platform with the Zitadel environment variables for the
 * selected environment. Production requires `environments.production.issuer`
 * in `zitadel.json` and fails with `E_VALIDATION` otherwise. With `manual` or
 * `dryRun` it returns the manual setup steps without configuring anything.
 * Returns the adapter result so callers (e.g. `setup`) can surface manual
 * steps as warnings.
 */
export async function runDeployConnect(io: CliIO, opts: DeployOptions) {
  const secret = await readZitadelSecret(opts.cwd);
  const config = await readZitadelConfig(opts.cwd);
  const adapter = await detectDeployTarget(opts.cwd, opts.platform);
  const environment = parseDeployEnvironment(opts.environment);

  if (environment === "production" && !readProductionIssuer(config)) {
    throw new ZitadelError(
      "E_VALIDATION",
      "Production deploys require environments.production.issuer in zitadel.json",
      {
        hint: "Add a production issuer, then run `zitadel deploy connect --environment production`.",
      },
    );
  }

  const vars = environment === "preview" ? previewVars(secret) : productionVars(secret, config);

  const result =
    opts.manual || opts.dryRun
      ? {
          platform: adapter.id,
          environment,
          configured: false,
          state: (await adapter.status(opts.cwd)).state,
          manual_steps: adapter.manualInstructions(environment, vars),
          variables: Object.keys(vars),
        }
      : environment === "preview"
        ? await adapter.configurePreviewEnv(opts.cwd, vars, { dryRun: opts.dryRun })
        : await adapter.configureProductionEnv(opts.cwd, vars, { dryRun: opts.dryRun });

  if (!opts.silent) {
    ok(io, result, opts, result.configured ? [] : result.manual_steps);
  }
  return result;
}

function parseDeployEnvironment(value: string | undefined): "preview" | "production" {
  if (!value || value === "preview") {
    return "preview";
  }
  if (value === "production") {
    return "production";
  }
  throw new ZitadelError("E_VALIDATION", `Invalid deploy environment "${value}"`, {
    hint: "Use preview or production.",
  });
}

function previewVars(secret: { project_id: string; preview_secret: string }): DeployEnvVars {
  return {
    ZITADEL_PROJECT_ID: secret.project_id,
    ZITADEL_ENVIRONMENT: "preview",
    ZITADEL_PREVIEW_SECRET: secret.preview_secret,
  };
}

function productionVars(
  secret: {
    project_id: string;
    project_secret: string;
  },
  config: Record<string, unknown>,
): DeployEnvVars {
  return {
    ZITADEL_PROJECT_ID: secret.project_id,
    ZITADEL_ENVIRONMENT: "production",
    ZITADEL_PROJECT_SECRET: secret.project_secret,
    ZITADEL_ISSUER: String(readProductionIssuer(config) ?? ""),
  };
}

function readProductionIssuer(config: Record<string, unknown>): unknown {
  if (!isObject(config.environments) || !isObject(config.environments.production)) {
    return undefined;
  }
  return config.environments.production.issuer;
}
