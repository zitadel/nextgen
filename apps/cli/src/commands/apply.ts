import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { detectDeployTarget } from "../deploy";
import type { CliIO, GlobalOptions } from "../io/output";
import { ok } from "../io/output";
import { ZitadelError } from "../lib/errors";
import { sha256 } from "../lib/hash";
import { createPlatformClient } from "../platform";
import { environmentSchema, type ZitadelEnvironment } from "../platform/schemas";
import { scaffold } from "../scaffolder";
import { CLI_VERSION } from "../lib/version";
import { readZitadelConfig, readZitadelSecret, schemaVersionFromConfig } from "./shared";

export type ApplyOptions = GlobalOptions & {
  environment?: string;
  silent?: boolean;
  planOnly?: boolean;
  platform?: string;
};

export async function runApply(io: CliIO, opts: ApplyOptions): Promise<Record<string, unknown>> {
  const environment = parseEnvironment(opts.environment);
  const config = await readZitadelConfig(opts.cwd);
  const secret = await readZitadelSecret(opts.cwd);
  const hash = sha256(config);
  const filesRead = await assertReferencedFilesExist(opts.cwd, config);
  const envRefs = findEnvRefs(config);
  const missingEnv = envRefs.filter((name) => !io.env[name]);
  const deploy = await detectDeployTarget(opts.cwd, opts.platform);
  const blockers: string[] = [];

  if (environment === "production" && !isClaimedSecret(secret)) {
    blockers.push("Production applies require a claimed project. Run `zitadel claim`.");
  }
  if (missingEnv.length > 0) {
    blockers.push(`Missing environment variables: ${missingEnv.join(", ")}`);
  }

  const nextCommandsForBlockers = environment === "production" && !isClaimedSecret(secret) ? ["zitadel claim"] : undefined;

  const planning = opts.planOnly || opts.dryRun;
  const baseData = {
    project_id: secret.project_id,
    lifecycle: isClaimedSecret(secret) ? "claimed" : "pre-claim",
    environment,
    hash,
    files_read: filesRead,
    env_refs: {
      resolved: envRefs.filter((name) => Boolean(io.env[name])),
      missing: missingEnv,
    },
    deploy: await deploy.status(opts.cwd),
    blockers,
  };

  if (blockers.length > 0 && !planning) {
    throw new ZitadelError(environment === "production" ? "E_CLAIM_REQUIRED" : "E_VALIDATION", blockers[0], {
      details: baseData,
      nextCommands: nextCommandsForBlockers,
    });
  }

  if (planning) {
    const data = {
      ...baseData,
      dry_run: true,
      uploaded: false,
      pending_upload: blockers.length === 0,
    };
    if (!opts.silent) ok(io, data, opts);
    return data;
  }

  const client = createPlatformClient(opts.source, secret.project_secret);
  const response = await client.uploadConfig(secret.project_id, environment, {
    config,
    hash,
    schema_version: schemaVersionFromConfig(config),
    sdk_version: CLI_VERSION,
  });
  await scaffold(
    {
      ops: [
        {
          kind: "merge-json",
          path: ".zitadel/state.json",
          patch: {
            config_hash: response.hash,
            last_apply: {
              applied_at: response.applied_at,
              environment,
              config_version: response.config_version,
              hash: response.hash,
              source: opts.source,
            },
          },
        },
      ],
      summary: [],
    },
    { cwd: opts.cwd, dryRun: false, force: true },
  );
  const data = {
    ...baseData,
    hash: response.hash,
    config_version: response.config_version,
    state_recorded: true,
    server_capabilities: response.server_capabilities,
    warnings: response.warnings,
  };
  if (!opts.silent) {
    ok(
      io,
      data,
      opts,
      response.warnings.map((warning) => warning.message),
    );
  }
  return data;
}

function parseEnvironment(value: string | undefined): ZitadelEnvironment {
  const result = environmentSchema.safeParse(value ?? "development");
  if (!result.success) {
    throw new ZitadelError("E_VALIDATION", `Invalid environment "${value}"`, {
      hint: "Use one of: development, preview, production.",
    });
  }
  return result.data;
}

async function assertReferencedFilesExist(cwd: string, config: Record<string, unknown>): Promise<string[]> {
  const paths = [
    ...Object.values(isObject(config.flows) ? config.flows : {}),
    ...Object.values(isObject(config.schemas) ? config.schemas : {}),
  ].filter((value): value is string => typeof value === "string");

  for (const path of paths) {
    try {
      await readFile(join(cwd, path), "utf8");
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT") {
        throw new ZitadelError("E_VALIDATION", `Referenced config file ${path} was not found`, {
          details: { path },
        });
      }
      throw error;
    }
  }

  return ["zitadel.json", ...paths];
}

function findEnvRefs(value: unknown): string[] {
  const refs = new Set<string>();
  const visit = (node: unknown): void => {
    if (typeof node === "string") {
      for (const match of node.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
        refs.add(match[1]);
      }
    } else if (Array.isArray(node)) {
      node.forEach(visit);
    } else if (isObject(node)) {
      Object.values(node).forEach(visit);
    }
  };
  visit(value);
  return [...refs].sort();
}

function isClaimedSecret(secret: { claimed_at?: string; team_id?: string }): boolean {
  return Boolean(secret.claimed_at && secret.team_id);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
