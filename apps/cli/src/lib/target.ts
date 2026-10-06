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
export const TARGET_KEYS = [
  "ZITADEL_URL",
  "ZITADEL_PROJECT_ID",
  "ZITADEL_PROJECT_SECRET",
  "ZITADEL_PREVIEW_TOKEN",
  "ZITADEL_PUBLISHABLE_KEY",
] as const;

export type TargetKey = (typeof TARGET_KEYS)[number];

/** One resolved value and where it came from, for `zitadel env`. */
export type Resolved = Readonly<{ value: string; source: string }>;

/** One place the chain looked, and what it supplied. */
export type Consulted = Readonly<{
  source: string;
  /** `not set` for a flag, `not present` for a missing file, else the keys it gave. */
  supplied: "not set" | "not present" | readonly TargetKey[];
}>;

export type Target = Readonly<{
  environment: Resolved;
  values: Readonly<Partial<Record<TargetKey, Resolved>>>;
  consulted: readonly Consulted[];
}>;

export type ResolveTargetInput = Readonly<{
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

type Source = Readonly<{ label: string; values: Partial<Record<TargetKey, string>> | undefined }>;

async function readEnvFile(path: string): Promise<Partial<Record<TargetKey, string>> | undefined> {
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

function pick(values: Record<string, string | undefined>): Partial<Record<TargetKey, string>> {
  const out: Partial<Record<TargetKey, string>> = {};
  for (const key of TARGET_KEYS) {
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
export async function resolveTarget(input: ResolveTargetInput): Promise<Target> {
  if (input.envName && input.envFile) {
    throw new ZitadelError("E_VALIDATION", "--env and --env-file are mutually exclusive", {
      hint: "--env picks files by the .env.<name>.local convention; --env-file names one file outright.",
    });
  }
  const environment = input.envFile
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
    for (const file of envFilesFor(environment.value)) {
      sources.push({ label: file, values: await readEnvFile(join(input.cwd, file)) });
    }
  }
  sources.push({ label: ".zitadel/secret", values: await secretValues(input.cwd) });

  const values: Partial<Record<TargetKey, Resolved>> = {};
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
    const supplied: TargetKey[] = [];
    for (const key of TARGET_KEYS) {
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

  return { environment, values, consulted };
}

/** `acme-staging` for `./infra/acme-staging.env`, for display only. */
function environmentNameOf(envFile: string): string {
  const base = envFile.split(/[\\/]/).at(-1) ?? envFile;
  return base.replace(/^\.env\.?/, "").replace(/\.(env|local)$/g, "") || base;
}

async function secretValues(cwd: string): Promise<Partial<Record<TargetKey, string>> | undefined> {
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
export function requireValue(target: Target, key: TargetKey): string {
  const resolved = target.values[key];
  if (resolved) {
    return resolved.value;
  }
  const looked = target.consulted
    .map((entry) =>
      `  ${entry.source.padEnd(28)} ${
        typeof entry.supplied === "string" ? `(${entry.supplied})` : entry.supplied.join(", ") || "(no relevant keys)"
      }`,
    )
    .join("\n");
  throw new ZitadelError(
    "E_VALIDATION",
    `${key} is not set for environment ${target.environment.value}`,
    {
      hint: `Set ${key} in .env.${target.environment.value}.local or the process environment, or run \`zitadel env add ${target.environment.value}\`.\nconsulted, in order:\n${looked}`,
      // A development environment with nothing bound is a directory `setup`
      // has not run in; any other name is bound with `env add`.
      nextCommands: [
        ...(target.environment.value === "development" ? ["zitadel setup"] : []),
        `zitadel env add ${target.environment.value}`,
      ],
    },
  );
}

/** The platform connection a deploy-style command needs. */
export type Connected = Readonly<{
  client: ZitadelClient;
  projectId: string;
  server: string;
  target: Target;
}>;

/**
 * Opens the connection for a command, authenticated with the project secret.
 * A preview run passes `credential: "preview"` to prefer the preview token,
 * which is all a pull-request build holds.
 */
export async function connectTarget(
  input: ResolveTargetInput,
  {
    credential = "project",
    verbatim = false,
  }: { credential?: "project" | "preview"; verbatim?: boolean } = {},
): Promise<Connected & { credentialSource: TargetKey }> {
  const target = await resolveTarget(input);
  const server = requireValue(target, "ZITADEL_URL");
  const projectId = requireValue(target, "ZITADEL_PROJECT_ID");
  const preferred: TargetKey =
    credential === "preview" && target.values.ZITADEL_PREVIEW_TOKEN
      ? "ZITADEL_PREVIEW_TOKEN"
      : "ZITADEL_PROJECT_SECRET";
  const token = requireValue(target, preferred);
  return {
    client: createZitadelClient({ baseUrl: server, token }, { verbatim }),
    projectId,
    server,
    target,
    credentialSource: preferred,
  };
}

/** The `.env.<name>.local` files on disk that bind an environment to a project. */
export async function listLocalEnvironments(
  cwd: string,
): Promise<Array<{ name: string; file: string; values: Partial<Record<TargetKey, string>> }>> {
  let names: string[];
  try {
    names = await readdir(cwd);
  } catch {
    return [];
  }
  const found: Array<{ name: string; file: string; values: Partial<Record<TargetKey, string>> }> =
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
