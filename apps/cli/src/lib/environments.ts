import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ZitadelError } from "./errors";
import { isObject, parseJsonObject } from "./json";
import { readZitadelConfig, readZitadelSecret } from "./project";
import { resolveServer } from "./server";

/**
 * The environment names an app deploys to, as `zitadel.json` names them. They
 * describe where the *frontend* runs; each maps to a project on a server.
 * `development` is the default target of every configuration command.
 */
export const DEFAULT_ENVIRONMENT = "development";
export const KNOWN_ENVIRONMENTS = ["development", "preview", "production"] as const;

/**
 * One entry of `zitadel.json`'s `environments` map. Every field is optional:
 * an entry with nothing but an `issuer` means "same server and project as the
 * top-level config", which is how setup has always written `development`.
 */
export type EnvironmentEntry = {
  /** Server origin, or `local` for the CLI-managed local runtime. */
  server?: string;
  /** Project id on that server. Absent means the top-level project. */
  project?: string;
  /** Fixed origin(s) the frontend is served from in this environment. */
  issuer?: string | string[];
  /** Origin patterns (`https://*.vercel.app`) for per-deployment hostnames. */
  issuer_pattern?: string[];
};

/**
 * Where a configuration command talks to for one named environment: the
 * server, the project on it, and the credential that project accepts.
 */
export type EnvironmentTarget = {
  name: string;
  server: string;
  serverOrigin: "flag" | "env" | "config-env" | "config-top" | "default" | "local";
  projectId: string;
  token: string;
  entry: EnvironmentEntry;
};

/** Reads the `environments` map from a parsed `zitadel.json`. */
export function readEnvironmentEntries(
  config: Record<string, unknown>,
): Record<string, EnvironmentEntry> {
  if (!isObject(config.environments)) {
    return {};
  }
  const out: Record<string, EnvironmentEntry> = {};
  for (const [name, raw] of Object.entries(config.environments)) {
    if (!isObject(raw)) {
      continue;
    }
    const entry: EnvironmentEntry = {};
    if (typeof raw.server === "string") entry.server = raw.server;
    if (typeof raw.project === "string") entry.project = raw.project;
    if (typeof raw.issuer === "string") entry.issuer = raw.issuer;
    else if (Array.isArray(raw.issuer)) {
      entry.issuer = raw.issuer.filter((v): v is string => typeof v === "string");
    }
    if (Array.isArray(raw.issuer_pattern)) {
      entry.issuer_pattern = raw.issuer_pattern.filter((v): v is string => typeof v === "string");
    }
    out[name] = entry;
  }
  return out;
}

/**
 * Resolves the server, project and credential a command should use for the
 * named environment.
 *
 * The server follows the usual precedence (`--server`, `ZITADEL_API_BASE`,
 * the entry's `server`, the top-level `server`). The project is the entry's
 * `project`, else the project in `.zitadel/secret`. The credential is the
 * project secret when the project matches, otherwise the per-environment
 * secret setup wrote to `.zitadel/secret.<name>` for an isolated project.
 */
export async function resolveEnvironmentTarget(opts: {
  cwd: string;
  name: string;
  env: NodeJS.ProcessEnv;
  serverFlag?: string;
}): Promise<EnvironmentTarget> {
  const config = await readZitadelConfig(opts.cwd);
  const entries = readEnvironmentEntries(config);
  const entry = entries[opts.name];
  if (!entry && opts.name !== DEFAULT_ENVIRONMENT) {
    throw new ZitadelError("E_VALIDATION", `Environment "${opts.name}" is not declared in zitadel.json`, {
      hint:
        `Declared environments: ${Object.keys(entries).join(", ") || "(none)"}. ` +
        `Add "${opts.name}" under "environments" in zitadel.json, or pick one of the declared names with --env.`,
      details: { environment: opts.name, declared: Object.keys(entries) },
    });
  }
  const server = await resolveServer({
    cwd: opts.cwd,
    env: opts.env,
    serverFlag: opts.serverFlag,
    environment: opts.name,
  });
  const secret = await readZitadelSecret(opts.cwd);
  const projectId = entry?.project ?? secret.project_id;
  const token = await resolveEnvironmentToken(opts.cwd, opts.name, projectId, secret);
  return {
    name: opts.name,
    server: server.value,
    serverOrigin: server.origin,
    projectId,
    token,
    entry: entry ?? {},
  };
}

/**
 * The origins an environment's frontend is served from: its fixed `issuer`
 * origin(s) plus its `issuer_pattern` wildcards, normalised to origins
 * (scheme + host[:port], lowercased), deduplicated, in declaration order.
 */
export function originsForEntry(entry: EnvironmentEntry): string[] {
  const raw = [
    ...(typeof entry.issuer === "string" ? [entry.issuer] : (entry.issuer ?? [])),
    ...(entry.issuer_pattern ?? []),
  ];
  const out: string[] = [];
  for (const value of raw) {
    const origin = toOrigin(value);
    if (origin && !out.includes(origin)) out.push(origin);
  }
  return out;
}

/**
 * Every origin the named project must allow: the union over the entries of
 * `zitadel.json` that point at it. `defaultProjectId` is the project an
 * entry without `project` belongs to (the one in `.zitadel/secret`).
 */
export function projectOriginsFromConfig(
  config: Record<string, unknown>,
  projectId: string,
  defaultProjectId: string,
): string[] {
  const out: string[] = [];
  for (const entry of Object.values(readEnvironmentEntries(config))) {
    if ((entry.project ?? defaultProjectId) !== projectId) continue;
    for (const origin of originsForEntry(entry)) {
      if (!out.includes(origin)) out.push(origin);
    }
  }
  return out;
}

/**
 * `https://App.Example.com/path` → `https://app.example.com`. A wildcard
 * pattern cannot go through `URL`, so it is trimmed of any trailing path.
 */
function toOrigin(value: string): string | undefined {
  const trimmed = value.trim().toLowerCase();
  if (!/^https?:\/\//.test(trimmed)) return undefined;
  if (trimmed.includes("*")) {
    const slash = trimmed.indexOf("/", "https://".length);
    return slash === -1 ? trimmed : trimmed.slice(0, slash);
  }
  try {
    return new URL(trimmed).origin;
  } catch {
    return undefined;
  }
}

/** Path of the credential file setup writes for an isolated environment. */
export function environmentSecretPath(cwd: string, name: string): string {
  return join(cwd, `.zitadel/secret.${name}`);
}

async function resolveEnvironmentToken(
  cwd: string,
  name: string,
  projectId: string,
  secret: { project_id: string; project_secret: string },
): Promise<string> {
  if (projectId === secret.project_id) {
    return secret.project_secret;
  }
  try {
    const raw = parseJsonObject(
      await readFile(environmentSecretPath(cwd, name), "utf8"),
      `.zitadel/secret.${name}`,
    );
    if (raw.project_id === projectId && typeof raw.project_secret === "string") {
      return raw.project_secret;
    }
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }
  }
  throw new ZitadelError(
    "E_VALIDATION",
    `No credential for project ${projectId} of environment "${name}"`,
    {
      hint:
        `The environment points at a project other than the one in .zitadel/secret. ` +
        `Expected its secret at .zitadel/secret.${name} — setup writes it when it creates an isolated project.`,
      details: { environment: name, project_id: projectId },
    },
  );
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
