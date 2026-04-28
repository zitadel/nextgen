import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { detectDeployTarget } from "../deploy";
import type { CliIO, GlobalOptions } from "../io/output";
import { ok } from "../io/output";
import { ZitadelError } from "../lib/errors";
import { sha256 } from "../lib/hash";
import { CLI_VERSION } from "../lib/version";
import { createPlatformClient } from "../platform";
import { environmentSchema, type ZitadelEnvironment } from "../platform/schemas";
import { flowDefinitionSchema } from "../resources/flow";
import { scaffold } from "../scaffolder";
import { validateLiquidTemplate } from "../templates/validate";
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
  const filesRead = await assertReferencedFilesExist(opts.cwd, config);
  const resourceBundle = await readResourceBundle(opts.cwd, filesRead);
  validateFlowDefinitions(resourceBundle);
  const templateFiles = await readTemplates(opts.cwd);
  validateTemplates(templateFiles);
  const hash = sha256({ config, resources: resourceBundle, templates: templateFiles });
  const envRefs = [...findEnvRefs(config), ...findEnvRefs(resourceBundle)].filter(uniq).sort();
  const missingEnv = envRefs.filter((name) => !io.env[name]);
  const deploy = await detectDeployTarget(opts.cwd, opts.platform);
  const blockers: string[] = [];

  if (environment === "production" && !isClaimedSecret(secret)) {
    blockers.push("Production applies require a claimed project. Run `zitadel claim`.");
  }
  if (missingEnv.length > 0) {
    blockers.push(`Missing environment variables: ${missingEnv.join(", ")}`);
  }

  const nextCommandsForBlockers =
    environment === "production" && !isClaimedSecret(secret) ? ["zitadel claim"] : undefined;

  const planning = opts.planOnly || opts.dryRun;
  const resourceCounts = countResources(resourceBundle);
  const baseData = {
    project_id: secret.project_id,
    lifecycle: isClaimedSecret(secret) ? "claimed" : "pre-claim",
    environment,
    hash,
    files_read: [...filesRead, ...Object.keys(templateFiles)].sort(),
    resources: { ...resourceCounts, templates: Object.keys(templateFiles).length },
    env_refs: {
      resolved: envRefs.filter((name) => Boolean(io.env[name])),
      missing: missingEnv,
    },
    deploy: await deploy.status(opts.cwd),
    blockers,
  };

  if (blockers[0] !== undefined && !planning) {
    throw new ZitadelError(
      environment === "production" ? "E_CLAIM_REQUIRED" : "E_VALIDATION",
      blockers[0],
      {
        details: baseData,
        nextCommands: nextCommandsForBlockers,
      },
    );
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
    resources: resourceBundle,
    templates: templateFiles,
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

async function assertReferencedFilesExist(
  cwd: string,
  _config: Record<string, unknown>,
): Promise<string[]> {
  const directories: Array<{ dir: string; required: boolean }> = [
    { dir: ".zitadel/schemas", required: true },
    { dir: ".zitadel/flows", required: true },
    { dir: ".zitadel/locales", required: false },
    { dir: ".zitadel/idps", required: false },
    { dir: ".zitadel/apps", required: false },
  ];

  const paths: string[] = [];
  for (const { dir, required } of directories) {
    const files = await listResourceFiles(join(cwd, dir));
    if (files === undefined) {
      if (required) {
        throw new ZitadelError("E_VALIDATION", `Required resource directory ${dir} was not found`, {
          details: { dir },
        });
      }
      continue;
    }
    for (const file of files) {
      paths.push(join(dir, file));
    }
  }

  for (const path of paths) {
    try {
      await readFile(join(cwd, path), "utf8");
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "ENOENT"
      ) {
        throw new ZitadelError("E_VALIDATION", `Referenced config file ${path} was not found`, {
          details: { path },
        });
      }
      throw error;
    }
  }

  return ["zitadel.json", ...paths];
}

async function listResourceFiles(dir: string): Promise<string[] | undefined> {
  try {
    const entries = await readdir(dir);
    return entries.filter((entry) => entry.endsWith(".json")).sort();
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  }
}

async function readResourceBundle(
  cwd: string,
  paths: string[],
): Promise<Record<string, Record<string, unknown>>> {
  const bundle: Record<string, Record<string, unknown>> = {};
  for (const path of paths) {
    if (path === "zitadel.json") continue;
    try {
      bundle[path] = JSON.parse(await readFile(join(cwd, path), "utf8")) as Record<string, unknown>;
    } catch (error) {
      throw new ZitadelError("E_VALIDATION", `Resource ${path} is not valid JSON`, {
        details: { path, cause: error instanceof Error ? error.message : String(error) },
      });
    }
  }
  return bundle;
}

function countResources(bundle: Record<string, Record<string, unknown>>): {
  schemas: number;
  flows: number;
  locales: number;
  idps: number;
  apps: number;
} {
  const out = { schemas: 0, flows: 0, locales: 0, idps: 0, apps: 0 };
  for (const path of Object.keys(bundle)) {
    if (path.startsWith(".zitadel/schemas/")) out.schemas += 1;
    else if (path.startsWith(".zitadel/flows/")) out.flows += 1;
    else if (path.startsWith(".zitadel/locales/")) out.locales += 1;
    else if (path.startsWith(".zitadel/idps/")) out.idps += 1;
    else if (path.startsWith(".zitadel/apps/")) out.apps += 1;
  }
  return out;
}

function validateFlowDefinitions(bundle: Record<string, Record<string, unknown>>): void {
  const issues: Array<{ path: string; issues: unknown }> = [];
  for (const [path, contents] of Object.entries(bundle)) {
    if (!path.startsWith(".zitadel/flows/")) continue;
    const parsed = flowDefinitionSchema.safeParse(contents);
    if (!parsed.success) {
      issues.push({ path, issues: parsed.error.issues });
    }
  }
  if (issues.length > 0) {
    throw new ZitadelError("E_VALIDATION", "One or more flow definitions are invalid", {
      details: { issues },
    });
  }
}

async function readTemplates(cwd: string): Promise<Record<string, string>> {
  const dir = join(cwd, ".zitadel/templates");
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return {};
    }
    throw error;
  }
  const out: Record<string, string> = {};
  for (const entry of entries.filter((name) => name.endsWith(".liquid")).sort()) {
    out[`.zitadel/templates/${entry}`] = await readFile(join(dir, entry), "utf8");
  }
  return out;
}

function validateTemplates(templates: Record<string, string>): void {
  const issues: Array<{ path: string; issues: unknown }> = [];
  for (const [path, source] of Object.entries(templates)) {
    const result = validateLiquidTemplate(source);
    if (!result.valid) {
      issues.push({ path, issues: result.issues });
    }
  }
  if (issues.length > 0) {
    throw new ZitadelError("E_VALIDATION", "One or more Liquid templates failed validation", {
      hint: "Banned: | raw filter, <script> tags, inline event handlers (on*=).",
      details: { issues },
    });
  }
}

function uniq<T>(value: T, index: number, array: T[]): boolean {
  return array.indexOf(value) === index;
}

export function findEnvRefs(value: unknown): string[] {
  const refs = new Set<string>();
  const visit = (node: unknown): void => {
    if (typeof node === "string") {
      for (const match of node.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
        refs.add(match[1]);
      }
    } else if (Array.isArray(node)) {
      node.forEach(visit);
    } else if (isObject(node)) {
      for (const [key, child] of Object.entries(node)) {
        if (
          key.endsWith("_env") &&
          typeof child === "string" &&
          /^[A-Za-z_][A-Za-z0-9_]*$/.test(child)
        ) {
          refs.add(child);
        } else {
          visit(child);
        }
      }
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
