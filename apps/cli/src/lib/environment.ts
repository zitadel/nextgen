import { chmod, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseEnv } from "node:util";

import { password, text } from "@clack/prompts";

import { ZitadelError } from "./errors";
import { hasZitadelSecret, readZitadelSecret } from "./project";
import { bailOnCancel } from "./prompt-cancel";
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

/**
 * An environment name is interpolated into the `.env.<name>.local` paths the
 * chain reads and writes, so a name carrying a slash or `..` would let a value
 * from `--env` or `ZITADEL_ENV` escape the project directory. Only a
 * conservative charset is allowed — letters, digits, dot, dash, underscore —
 * and a `..` sequence is refused outright, before the name reaches any path.
 */
const ENVIRONMENT_NAME = /^[A-Za-z0-9._-]+$/;

/**
 * Whether a value is usable as an environment name: the rule the
 * `.env.<name>.local` paths require, shared with `env add` so a name `--env`
 * resolves can also be bound.
 */
export function isEnvironmentName(value: string): boolean {
  return ENVIRONMENT_NAME.test(value) && !value.includes("..");
}

function assertEnvironmentName(name: Resolved): void {
  if (isEnvironmentName(name.value)) {
    return;
  }
  throw new ZitadelError("E_VALIDATION", `${name.value} is not a valid environment name`, {
    hint:
      `The ${name.source} environment name may use only letters, digits, dot, dash ` +
      'and underscore, and may not contain "..". Pass a safe --env or set ZITADEL_ENV.',
  });
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
  assertEnvironmentName(name);

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

/** The values that grant access, prompted without echo and persisted at 0600. */
const SECRET_KEYS: ReadonlySet<EnvironmentKey> = new Set([
  "ZITADEL_PROJECT_SECRET",
  "ZITADEL_PREVIEW_TOKEN",
]);

/**
 * Like {@link requireValue}, but on an interactive terminal a missing value is
 * asked for and persisted to `.env.<name>.local` before it is returned, so the
 * next run resolves it from the file rather than asking again (#1313). A secret
 * is asked for without echo and the file is written `0600`.
 *
 * Non-interactive runs never prompt: they throw exactly as {@link requireValue}
 * does, naming every source the chain consulted, so a scripted caller stays
 * deterministic. The prompt is gated by the caller passing `interactive`, which
 * is already false under `--json`, `--non-interactive` and a non-TTY.
 */
export async function requireValueInteractive(
  environment: Environment,
  key: EnvironmentKey,
  options: { cwd: string; interactive: boolean },
): Promise<string> {
  const resolved = environment.values[key];
  if (resolved) {
    return resolved.value;
  }
  if (!options.interactive) {
    // Deterministic failure, identical to the non-interactive contract.
    return requireValue(environment, key);
  }
  const name = environment.name.value;
  const ask = SECRET_KEYS.has(key) ? password : text;
  const answer = await ask({ message: `${key} for the ${name} environment` });
  bailOnCancel(answer, `Resolving ${key}`);
  const typed = String(answer).trim();
  if (typed === "") {
    // An empty answer is no answer; fall through to the same throw.
    return requireValue(environment, key);
  }
  // Persist (and return) the normalized form, matching how the resolver stores
  // a server value, so the file and this run agree with every later run.
  const value = key === "ZITADEL_URL" ? serverOrigin(typed) : typed;
  await persistEnvValue(join(options.cwd, `.env.${name}.local`), key, value);
  return value;
}

/**
 * Appends `key=value` to a `.env.<name>.local`, creating it if absent, and
 * holds the file at `0600` because it may carry a secret. Newline-safe so a
 * file without a trailing newline is not concatenated onto its last line.
 */
async function persistEnvValue(path: string, key: EnvironmentKey, value: string): Promise<void> {
  // One `key=value` per line is the whole file format, so a line break in the
  // value would inject a spurious line (or split a secret) that the next run
  // reads back as different keys. A break is never a legitimate credential, URL
  // or id, so refuse it rather than write a file we cannot read back faithfully.
  if (/[\n\r]/.test(value)) {
    throw new Error(`Refusing to persist ${key}: value contains a line break.`);
  }
  let existing = "";
  try {
    existing = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  const next = `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}${key}=${value}\n`;
  await writeFile(path, next, { mode: 0o600 });
  // `writeFile`'s mode applies only on creation and is masked by the umask, so
  // re-assert 0600. The file may hold a secret, so a chmod we cannot apply means
  // we cannot promise the credential file is private — surface it, do not hide
  // it behind a success.
  await chmod(path, 0o600);
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
