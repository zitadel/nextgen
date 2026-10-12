import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseEnv } from "node:util";

import { ZitadelError } from "./errors";
import { hasZitadelSecret, readZitadelSecret } from "./project";
import { resolveServer, serverOrigin } from "./server";

/**
 * The values a command reads from an environment. Each resolves on its own, so
 * a file holding only the project id leaves the server to the process
 * environment. `ZITADEL_ISSUER` is the origin the app serves from, which
 * `setup` records beside the CLI's own values.
 */
export const ENVIRONMENT_KEYS = [
  "ZITADEL_URL",
  "ZITADEL_PROJECT_ID",
  "ZITADEL_PROJECT_SECRET",
  "ZITADEL_PREVIEW_TOKEN",
  "ZITADEL_PUBLISHABLE_KEY",
  "ZITADEL_RELEASE",
  "ZITADEL_ISSUER",
] as const;

export type EnvironmentKey = (typeof ENVIRONMENT_KEYS)[number];

/** One resolved value and where it came from. */
export type Resolved = Readonly<{ value: string; source: string }>;

/** One place the chain looked, and which keys it supplied. */
export type Consulted = Readonly<{
  source: string;
  /** Whether the flag was given, or the file exists. */
  present: boolean;
  /** The keys this source supplied that no earlier source had. */
  supplied: readonly EnvironmentKey[];
}>;

/** What a directory resolves to for one invocation. */
export type Environment = Readonly<{
  name: Resolved;
  values: Readonly<Partial<Record<EnvironmentKey, Resolved>>>;
  consulted: readonly Consulted[];
  /** The `--env-file` path as given, if one was. */
  envFile?: string;
}>;

export type ResolveEnvironmentInput = Readonly<{
  cwd: string;
  env: NodeJS.ProcessEnv;
  serverFlag?: string;
  envName?: string;
  envFile?: string;
}>;

type Values = Partial<Record<EnvironmentKey, string>>;

/** The environment names a platform build announces, by the variable it sets. */
const PLATFORM_SIGNALS: ReadonlyArray<{ variable: string; name: (value: string) => string }> = [
  { variable: "VERCEL_ENV", name: (value) => value },
  {
    variable: "CONTEXT",
    name: (value) => {
      if (value === "deploy-preview" || value === "branch-deploy") {
        return "preview";
      }
      return value === "dev" ? "development" : value;
    },
  },
];

/**
 * Which environment this invocation is in: `--env`, `ZITADEL_ENV`, a hosting
 * platform's own signal, else `development`. `NODE_ENV` is not consulted:
 * platforms set it to `production` for every build, previews included.
 */
function environmentName(env: NodeJS.ProcessEnv, flag?: string): Resolved {
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

/** The dotenv files read for an environment, highest priority first. */
function environmentFiles(name: string): readonly string[] {
  return [`.env.${name}.local`, ...(name === "test" ? [] : [".env.local"]), `.env.${name}`, ".env"];
}

function pick(values: Readonly<Record<string, string | undefined>>): Values {
  const picked: Values = {};
  for (const key of ENVIRONMENT_KEYS) {
    const value = values[key];
    if (value) {
      picked[key] = value;
    }
  }
  return picked;
}

/**
 * Reads the keys an environment cares about from one dotenv file, or
 * `undefined` when the file does not exist. Parsed with `node:util`'s
 * `parseEnv`, which is why this stays separate from the local runtime's loader
 * in `local-server/env-vars.ts`: that one is hard-coded to its own keys.
 */
async function readEnvFile(path: string): Promise<Values | undefined> {
  try {
    return pick(parseEnv(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

/**
 * Resolves the server, project and credentials a command addresses, each
 * value from the first source that supplies it: `--server`, `--env-file`, the
 * process environment, `.env.<env>.local`, `.env.local` (not for `test`),
 * `.env.<env>`, `.env`, then `.zitadel/secret`.
 *
 * `--env-file` outranks the process environment because a path typed on this
 * invocation is as explicit as `--server`; everywhere else the process
 * environment wins over files, so values a platform injects beat a stale
 * `.env` left in the tree.
 */
export async function resolveEnvironment(input: ResolveEnvironmentInput): Promise<Environment> {
  if (input.envName && input.envFile) {
    throw new ZitadelError("E_VALIDATION", "--env and --env-file cannot be used together", {
      hint: "--env picks the .env.<name>.local files; --env-file names one file outright.",
    });
  }
  const name = environmentName(input.env, input.envName);

  const sources: Array<{ source: string; values: Values | undefined }> = [
    {
      source: "--server",
      values: input.serverFlag
        ? {
            ZITADEL_URL: (await resolveServer({ cwd: input.cwd, serverFlag: input.serverFlag }))
              .value,
          }
        : undefined,
    },
  ];
  if (input.envFile) {
    const values = await readEnvFile(resolve(input.cwd, input.envFile));
    if (values === undefined) {
      throw new ZitadelError("E_VALIDATION", `--env-file ${input.envFile} was not found`);
    }
    sources.push({ source: `--env-file ${input.envFile}`, values });
  }
  sources.push({ source: "process environment", values: pick(input.env) });
  for (const file of environmentFiles(name.value)) {
    sources.push({ source: file, values: await readEnvFile(join(input.cwd, file)) });
  }
  const secret = (await hasZitadelSecret(input.cwd))
    ? await readZitadelSecret(input.cwd)
    : undefined;
  sources.push({
    source: ".zitadel/secret",
    values: secret && {
      ZITADEL_PROJECT_ID: secret.project_id,
      ZITADEL_PROJECT_SECRET: secret.project_secret,
      ZITADEL_PREVIEW_TOKEN: secret.preview_secret,
    },
  });

  const values: Partial<Record<EnvironmentKey, Resolved>> = {};
  const consulted: Consulted[] = [];
  for (const { source, values: supplied } of sources) {
    const taken: EnvironmentKey[] = [];
    for (const key of ENVIRONMENT_KEYS) {
      const value = supplied?.[key];
      if (value !== undefined && values[key] === undefined) {
        values[key] = { value: key === "ZITADEL_URL" ? serverOrigin(value) : value, source };
        taken.push(key);
      }
    }
    consulted.push({ source, present: supplied !== undefined, supplied: taken });
  }

  return {
    name,
    values,
    consulted,
    ...(input.envFile === undefined ? {} : { envFile: input.envFile }),
  };
}

/**
 * The value a command cannot run without, or an `E_VALIDATION` naming the
 * environment, the variable and every source the chain looked in.
 */
export function requireValue(environment: Environment, key: EnvironmentKey): string {
  const resolved = environment.values[key];
  if (resolved) {
    return resolved.value;
  }
  const name = environment.name.value;
  throw new ZitadelError("E_VALIDATION", `${key} is not set for the ${name} environment`, {
    hint:
      `Consulted, in order: ${environment.consulted.map((entry) => entry.source).join(", ")}. ` +
      `Set ${key} in .env.${name}.local or the process environment, or run \`zitadel env add ${name}\`.`,
    nextCommands: [name === "development" ? "zitadel setup" : `zitadel env add ${name}`],
    details: {
      environment: name,
      variable: key,
      consulted: environment.consulted.map((entry) => entry.source),
    },
  });
}

/**
 * The `.env.<name>.local` files in `cwd` that bind an environment to a
 * project, as `[name, file, values]`, ordered by name.
 */
export async function readBoundEnvironments(
  cwd: string,
): Promise<Array<{ name: string; file: string; values: Values }>> {
  const bound: Array<{ name: string; file: string; values: Values }> = [];
  for (const file of (await readdir(cwd)).sort()) {
    const name = /^\.env\.(.+)\.local$/.exec(file)?.[1];
    const values = name === undefined ? undefined : await readEnvFile(join(cwd, file));
    if (name !== undefined && values?.ZITADEL_PROJECT_ID) {
      bound.push({ name, file, values });
    }
  }
  return bound;
}
