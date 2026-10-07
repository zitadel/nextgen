import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { parseEnv } from "node:util";

import { createZitadelClient, type ZitadelClient } from "./api-client";
import { ZitadelError } from "./errors";
import { readZitadelSecret } from "./project";
import { resolveServer } from "./server";

/**
 * The values a command needs to address a server and a project. Each resolves
 * on its own, so a file holding only the project id leaves the server to the
 * process environment.
 */
export const ENVIRONMENT_KEYS = [
  "ZITADEL_URL",
  "ZITADEL_PROJECT_ID",
  "ZITADEL_PROJECT_SECRET",
  "ZITADEL_PREVIEW_TOKEN",
  "ZITADEL_PUBLISHABLE_KEY",
] as const;

export type EnvironmentKey = (typeof ENVIRONMENT_KEYS)[number];

/** One resolved value and where it came from, for `zitadel env`. */
export type Resolved = Readonly<{ value: string; source: string }>;

/** One place the chain looked, and what it supplied. */
export type Consulted = Readonly<{
  source: string;
  /** `not set` for a flag, `not present` for a missing file, else the keys it gave. */
  supplied: "not set" | "not present" | readonly EnvironmentKey[];
}>;

/** What a directory resolves to for one invocation: the environment's name, values and sources. */
export type Environment = Readonly<{
  name: Resolved;
  values: Readonly<Partial<Record<EnvironmentKey, Resolved>>>;
  consulted: readonly Consulted[];
}>;

export type ResolveEnvironmentInput = Readonly<{
  cwd: string;
  env: NodeJS.ProcessEnv;
  serverFlag?: string;
  envName?: string;
  envFile?: string;
}>;

/** The environment names a platform build announces, by the variable it sets. */
const PLATFORM_SIGNALS: ReadonlyArray<{
  variable: string;
  name: (value: string) => string;
}> = [
  { variable: "VERCEL_ENV", name: (value) => value },
  {
    variable: "CONTEXT",
    name: (value) => (value === "deploy-preview" || value === "branch-deploy" ? "preview" : value),
  },
];

/**
 * Which environment this invocation is in: `--env`, `ZITADEL_ENV`, a platform
 * signal, else `development`. `NODE_ENV` is not consulted: platforms set it to
 * `production` for every build, previews included.
 */
export function detectEnvironment(env: NodeJS.ProcessEnv, flag?: string): Resolved {
  if (flag) {
    return { value: flag, source: "--env" };
  }
  if (env.ZITADEL_ENV) {
    return { value: env.ZITADEL_ENV, source: "ZITADEL_ENV" };
  }
  for (const signal of PLATFORM_SIGNALS) {
    const value = env[signal.variable];
    if (value) {
      return { value: signal.name(value), source: signal.variable };
    }
  }
  return { value: "development", source: "default" };
}

/** The dotenv files the convention reads for one environment, highest priority first. */
export function envFilesFor(environment: string): readonly string[] {
  return [
    `.env.${environment}.local`,
    ...(environment === "test" ? [] : [".env.local"]),
    `.env.${environment}`,
    ".env",
  ];
}

type Source = Readonly<{ label: string; values: Partial<Record<EnvironmentKey, string>> | undefined }>;

async function readEnvFile(path: string): Promise<Partial<Record<EnvironmentKey, string>> | undefined> {
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  const parsed = parseEnv(contents.replace(/^﻿/, ""));
  return pick(parsed as Record<string, string | undefined>);
}

function pick(values: Record<string, string | undefined>): Partial<Record<EnvironmentKey, string>> {
  const out: Partial<Record<EnvironmentKey, string>> = {};
  for (const key of ENVIRONMENT_KEYS) {
    const value = values[key];
    if (typeof value === "string" && value !== "") {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Resolves the server, project and credentials a command addresses, each
 * value from the first source that supplies it: `--server`, `--env-file`, the
 * process environment, the `.env` files of the environment, `.zitadel/secret`.
 *
 * `--env-file` names one file outright and is read in place of the
 * convention, so a monorepo or a CI job can point at a file that does not sit
 * beside the working directory. It outranks the process environment because
 * a path typed on this invocation is as explicit as `--server`; otherwise the
 * process environment wins over every file, so a platform's injected values
 * beat a stale `.env` left in the tree.
 */
export async function resolveEnvironment(input: ResolveEnvironmentInput): Promise<Environment> {
  if (input.envName && input.envFile) {
    throw new ZitadelError("E_VALIDATION", "--env and --env-file are mutually exclusive", {
      hint: "--env picks files by the .env.<name>.local convention; --env-file names one file outright.",
    });
  }
  const name = input.envFile
    ? { value: environmentNameOf(input.envFile), source: "--env-file" }
    : detectEnvironment(input.env, input.envName);

  const sources: Source[] = [];
  if (input.envFile) {
    const path = isAbsolute(input.envFile) ? input.envFile : resolve(input.cwd, input.envFile);
    const values = await readEnvFile(path);
    if (values === undefined) {
      throw new ZitadelError("E_VALIDATION", `--env-file ${input.envFile} was not found`);
    }
    sources.push({ label: `--env-file ${input.envFile}`, values });
    sources.push({ label: "process env", values: pick(input.env) });
  } else {
    sources.push({ label: "process env", values: pick(input.env) });
    for (const file of envFilesFor(name.value)) {
      sources.push({ label: file, values: await readEnvFile(join(input.cwd, file)) });
    }
  }
  sources.push({ label: ".zitadel/secret", values: await secretValues(input.cwd) });

  const values: Partial<Record<EnvironmentKey, Resolved>> = {};
  const consulted: Consulted[] = [
    { source: "--server flag", supplied: input.serverFlag ? ["ZITADEL_URL"] : "not set" },
  ];
  if (input.serverFlag) {
    values.ZITADEL_URL = { value: input.serverFlag, source: "--server flag" };
  }
  for (const source of sources) {
    if (source.values === undefined) {
      consulted.push({ source: source.label, supplied: "not present" });
      continue;
    }
    const supplied: EnvironmentKey[] = [];
    for (const key of ENVIRONMENT_KEYS) {
      const value = source.values[key];
      if (value !== undefined && values[key] === undefined) {
        values[key] = { value, source: source.label };
        supplied.push(key);
      }
    }
    consulted.push({ source: source.label, supplied });
  }

  // `zitadel.json` is not in the chain for anything but the server, where it
  // is the bootstrap default `setup` wrote; `--server local` resolves there too.
  const server = await resolveServer({
    cwd: input.cwd,
    env: { ZITADEL_URL: values.ZITADEL_URL?.value },
    serverFlag: input.serverFlag,
  });
  values.ZITADEL_URL = {
    value: server.value,
    source: values.ZITADEL_URL?.source ?? (server.origin === "config-top" ? "zitadel.json" : "default"),
  };

  return { name, values, consulted };
}

/** `acme-staging` for `./infra/acme-staging.env`, for display only. */
function environmentNameOf(envFile: string): string {
  const base = envFile.split(/[\\/]/).at(-1) ?? envFile;
  return base.replace(/^\.env\.?/, "").replace(/\.(env|local)$/g, "") || base;
}

async function secretValues(cwd: string): Promise<Partial<Record<EnvironmentKey, string>> | undefined> {
  try {
    await stat(join(cwd, ".zitadel/secret"));
  } catch {
    return undefined;
  }
  const secret = await readZitadelSecret(cwd);
  return pick({
    ZITADEL_PROJECT_ID: secret.project_id,
    ZITADEL_PROJECT_SECRET: secret.project_secret,
    ZITADEL_PREVIEW_TOKEN: secret.preview_token,
    ZITADEL_PUBLISHABLE_KEY: secret.preview_secret,
  });
}

/**
 * The value a command cannot run without, or an error naming the environment,
 * the key and every place that was looked.
 */
export function requireValue(environment: Environment, key: EnvironmentKey): string {
  const resolved = environment.values[key];
  if (resolved) {
    return resolved.value;
  }
  const looked = environment.consulted
    .map((entry) =>
      `  ${entry.source.padEnd(28)} ${
        typeof entry.supplied === "string" ? `(${entry.supplied})` : entry.supplied.join(", ") || "(no relevant keys)"
      }`,
    )
    .join("\n");
  throw new ZitadelError(
    "E_VALIDATION",
    `${key} is not set for environment ${environment.name.value}`,
    {
      hint: `Set ${key} in .env.${environment.name.value}.local or the process environment, or run \`zitadel env add ${environment.name.value}\`.\nconsulted, in order:\n${looked}`,
      // A development environment with nothing bound is a directory `setup`
      // has not run in; any other name is bound with `env add`.
      nextCommands: [
        ...(environment.name.value === "development" ? ["zitadel setup"] : []),
        `zitadel env add ${environment.name.value}`,
      ],
    },
  );
}

/** The platform connection a deploy-style command needs. */
export type Connected = Readonly<{
  client: ZitadelClient;
  projectId: string;
  server: string;
  environment: Environment;
}>;

/**
 * Opens the connection for a command, authenticated with the project secret.
 * A preview run passes `credential: "preview"` to prefer the preview token,
 * which is all a pull-request build holds.
 */
export async function connectEnvironment(
  input: ResolveEnvironmentInput,
  {
    credential = "project",
    verbatim = false,
  }: { credential?: "project" | "preview"; verbatim?: boolean } = {},
): Promise<Connected & { credentialSource: EnvironmentKey }> {
  const environment = await resolveEnvironment(input);
  const server = requireValue(environment, "ZITADEL_URL");
  const projectId = requireValue(environment, "ZITADEL_PROJECT_ID");
  const preferred: EnvironmentKey =
    credential === "preview" && environment.values.ZITADEL_PREVIEW_TOKEN
      ? "ZITADEL_PREVIEW_TOKEN"
      : "ZITADEL_PROJECT_SECRET";
  const token = requireValue(environment, preferred);
  return {
    client: createZitadelClient({ baseUrl: server, token }, { verbatim }),
    projectId,
    server,
    environment,
    credentialSource: preferred,
  };
}

/** The `.env.<name>.local` files on disk that bind an environment to a project. */
export async function listLocalEnvironments(
  cwd: string,
): Promise<Array<{ name: string; file: string; values: Partial<Record<EnvironmentKey, string>> }>> {
  let names: string[];
  try {
    names = await readdir(cwd);
  } catch {
    return [];
  }
  const found: Array<{ name: string; file: string; values: Partial<Record<EnvironmentKey, string>> }> =
    [];
  for (const file of names.sort()) {
    const match = /^\.env\.([^.]+)\.local$/.exec(file);
    if (!match) {
      continue;
    }
    const values = await readEnvFile(join(cwd, file));
    if (values?.ZITADEL_PROJECT_ID) {
      found.push({ name: match[1] as string, file, values });
    }
  }
  return found;
}
