import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { ZitadelError } from "@/lib/errors";
import { Project } from "@/lib/project";
import { ZitadelRuntime } from "@/lib/server";

import { Dotenv } from "./dotenv";
import { EnvironmentName } from "./environment-name";
import { InitialRelease } from "./initial-release";
import { ENVIRONMENT_KEYS, SECRET_KEYS } from "./keys";
import type {
  BoundEnvironment,
  Consulted,
  EnvironmentKey,
  InitialDeployment,
  InitialReleaseInput,
  InteractiveOptions,
  Resolved,
  ResolveEnvironmentInput,
  Values,
} from "./types";

/**
 * What a directory resolves to for one invocation: the environment's name and
 * the server, project and credentials a command addresses, each with the
 * source it came from. It is the one way into this area; what is known
 * without a directory (the keys, which names are usable, what a first deploy
 * publishes) is on the class, and what is read from one is on an instance,
 * made with {@link Environment.resolve}.
 */
export class Environment {
  /** Every value a command reads from an environment, in the order they are reported. */
  static readonly KEYS: readonly EnvironmentKey[] = ENVIRONMENT_KEYS;

  /** The environment's name, and what named it. */
  readonly name: Resolved;

  /** Each value that resolved. */
  readonly values: Readonly<Partial<Record<EnvironmentKey, Resolved>>>;

  /** Every source the chain looked in, in order. */
  readonly consulted: readonly Consulted[];

  /** The `--env-file` path as given, if one was. */
  readonly envFile: string | undefined;

  /** The project directory the run resolved against. */
  readonly cwd: string;

  private constructor(parts: {
    name: Resolved;
    values: Readonly<Partial<Record<EnvironmentKey, Resolved>>>;
    consulted: readonly Consulted[];
    envFile: string | undefined;
    cwd: string;
  }) {
    this.name = parts.name;
    this.values = parts.values;
    this.consulted = parts.consulted;
    this.envFile = parts.envFile;
    this.cwd = parts.cwd;
  }

  /**
   * Resolves the server, project and credentials a command addresses, each
   * value from the first source that supplies it: `--server`, `--env-file`,
   * the process environment, `.env.<env>.local`, `.env.local`, `.env.<env>`,
   * `.env`, then `.zitadel/secret`. `.env.local` and `.zitadel/secret` hold
   * the project setup created, so only the default development environment,
   * without `--env-file`, reads them.
   *
   * `--env-file` outranks the process environment because a path typed on this
   * invocation is as explicit as `--server`; everywhere else the process
   * environment wins over files, so values a platform injects beat a stale
   * `.env` left in the tree.
   *
   * @param input - The directory, the process environment and the flags.
   * @returns The resolved environment.
   * @throws {ZitadelError} `E_VALIDATION` when `--env` and `--env-file` are
   *   both given, the name is not usable, the file is missing or a server is
   *   not a URL.
   */
  static async resolve(input: ResolveEnvironmentInput): Promise<Environment> {
    if (input.envName && input.envFile) {
      throw new ZitadelError("E_VALIDATION", "--env and --env-file cannot be used together", {
        hint: "--env picks the .env.<name>.local files; --env-file names one file outright.",
      });
    }
    const name = EnvironmentName.resolve(input.env, input.envName);

    const sources: Array<{ source: string; values: Values | undefined }> = [
      {
        source: "--server",
        values: input.serverFlag
          ? {
              ZITADEL_URL: (
                await ZitadelRuntime.resolve({ cwd: input.cwd, serverFlag: input.serverFlag })
              ).value,
            }
          : undefined,
      },
    ];
    if (input.envFile) {
      // From the shell's directory, not `--cwd`: Node reads `--env-file` from
      // the command line itself before the CLI starts, there, and exits when
      // the file is missing, so a path relative to `--cwd` never reaches this
      // read.
      const values = await Dotenv.at(resolve(input.envFile)).read();
      if (values === undefined) {
        throw new ZitadelError("E_VALIDATION", `--env-file ${input.envFile} was not found`);
      }
      sources.push({ source: `--env-file ${input.envFile}`, values });
    }
    sources.push({ source: "process environment", values: Dotenv.pick(input.env) });
    // `.env.local` and `.zitadel/secret` hold the project setup created, which
    // is the development one. A named environment or an explicit --env-file
    // that lacks a value must fail naming it, not borrow the development
    // project's id or credential and send it to another server.
    // An --env-file names its file outright, so no `.env.*` file fills its
    // gaps: with no --env the name is `development`, and
    // `.env.development.local` is setup's development project too.
    const setupFiles = name.value === "development" && input.envFile === undefined;
    if (input.envFile === undefined) {
      for (const file of name.files(setupFiles)) {
        sources.push({ source: file, values: await Dotenv.at(join(input.cwd, file)).read() });
      }
    }
    if (setupFiles) {
      const project = Project.at(input.cwd);
      const secret = (await project.hasSecret()) ? await project.secret() : undefined;
      sources.push({
        source: ".zitadel/secret",
        values: secret && {
          ZITADEL_PROJECT_ID: secret.data.project_id,
          ZITADEL_PROJECT_SECRET: secret.data.project_secret,
          ZITADEL_PREVIEW_TOKEN: secret.data.preview_secret,
        },
      });
    }

    const values: Partial<Record<EnvironmentKey, Resolved>> = {};
    const consulted: Consulted[] = [];
    for (const { source, values: supplied } of sources) {
      const taken: EnvironmentKey[] = [];
      for (const key of ENVIRONMENT_KEYS) {
        const value = supplied?.[key];
        if (value !== undefined && values[key] === undefined) {
          values[key] = {
            value: key === "ZITADEL_URL" ? Environment.originFrom(value, source) : value,
            source,
          };
          taken.push(key);
        }
      }
      consulted.push({ source, present: supplied !== undefined, supplied: taken });
    }

    return new Environment({ name, values, consulted, envFile: input.envFile, cwd: input.cwd });
  }

  /**
   * Whether a value is usable as an environment name: the rule the
   * `.env.<name>.local` paths require, so a name `--env` resolves can also be
   * bound by `env add`.
   *
   * @param value - The name to check.
   * @returns `true` when it can be used in a path.
   */
  static isName(value: string): boolean {
    return EnvironmentName.isValid(value);
  }

  /**
   * The `.env.<name>.local` files in a directory that bind an environment to
   * a project.
   *
   * @param cwd - The project's directory.
   * @returns The name, file and values of each, ordered by file.
   * @throws When the directory cannot be read.
   */
  static async bound(cwd: string): Promise<BoundEnvironment[]> {
    const bound: BoundEnvironment[] = [];
    for (const file of (await readdir(cwd)).sort()) {
      const name = /^\.env\.(.+)\.local$/.exec(file)?.[1];
      const values = name === undefined ? undefined : await Dotenv.at(join(cwd, file)).read();
      if (name !== undefined && values?.ZITADEL_PROJECT_ID) {
        bound.push({ name, file, values });
      }
    }
    return bound;
  }

  /**
   * Publishes `.zitadel/` to a project nothing has been deployed to, the way
   * `deploy` does. Temporary: `setup` and `env add` offer it until a project
   * is created with its first release.
   *
   * @param input - The project, the directory and how the run reports.
   * @returns What was published.
   * @throws When the bundle does not validate or the platform refuses it.
   */
  static deployInitialRelease(input: InitialReleaseInput): Promise<InitialDeployment> {
    return InitialRelease.of(input).deploy();
  }

  /**
   * The value a command cannot run without.
   *
   * @param key - The value.
   * @returns The value, from the first source that supplied it.
   * @throws {ZitadelError} `E_VALIDATION` naming the environment, the variable
   *   and every source the chain looked in.
   */
  require(key: EnvironmentKey): string {
    const resolved = this.values[key];
    if (resolved) {
      return resolved.value;
    }
    const name = this.name.value;
    const consulted = `Consulted, in order: ${this.consulted
      .map((entry) => {
        return entry.source;
      })
      .join(", ")}.`;
    // The file to set the value in. An --env-file run reads that file; an
    // environment already bound by `env add` has its `.env.<name>.local`. Only
    // an environment with no project at all is pointed at `env add` (or
    // `setup` for development): re-running `env add` on a bound one would
    // refuse, and with --force replace the binding with a new project, and
    // creating one where the process environment already names a project
    // would pair that project with another's credential.
    const boundFile = Project.envFileName(name);
    const bound = this.consulted.some((entry) => {
      return entry.source === boundFile && entry.present;
    });
    const file = this.envFile ?? (bound ? boundFile : undefined);
    const unbound = file === undefined && this.values.ZITADEL_PROJECT_ID === undefined;
    const elsewhere = this.cwd === process.cwd() ? {} : { cwd: this.cwd };
    throw new ZitadelError("E_VALIDATION", `${key} is not set for the ${name} environment`, {
      hint: unbound
        ? `${consulted} Set ${key} in ${boundFile} or the process environment, or run \`zitadel env add ${name}\`.`
        : `${consulted} Set ${key} in ${file ?? `${boundFile} or the process environment`}${file === undefined ? "" : " or the process environment"}.`,
      ...(unbound
        ? {
            // Run in the directory this run addressed, which need not be the
            // shell's: `setup` and `env add` both write their files there.
            nextCommands: [
              name === "development"
                ? { id: "setup", flags: elsewhere }
                : { id: "env:add", args: { name }, flags: elsewhere },
            ],
          }
        : {}),
      details: {
        environment: name,
        variable: key,
        consulted: this.consulted.map((entry) => {
          return entry.source;
        }),
      },
    });
  }

  /**
   * Like {@link Environment.require}, but on an interactive terminal a missing
   * value is asked for and persisted to `.env.<name>.local` before it is
   * returned, so the next run resolves it from the file rather than asking
   * again. A secret is asked for without echo and the file is written `0600`.
   * A run that named its own file with `--env-file` keeps the value for this
   * run only: writing it to `.env.<name>.local` would hand it to every later
   * run of that environment.
   *
   * Non-interactive runs never prompt: they throw exactly as
   * {@link Environment.require} does, naming every source the chain consulted,
   * so a scripted caller stays deterministic.
   *
   * @param key - The value.
   * @param options - The directory, whether asking is allowed, and who asks.
   * @returns The value, resolved or typed.
   * @throws {ZitadelError} `E_VALIDATION` when it is missing and may not be asked for.
   */
  async requireInteractive(key: EnvironmentKey, options: InteractiveOptions): Promise<string> {
    const resolved = this.values[key];
    if (resolved) {
      return resolved.value;
    }
    if (!options.interactive) {
      // Deterministic failure, identical to the non-interactive contract.
      return this.require(key);
    }
    const name = this.name.value;
    const question = {
      name: key,
      message: `What is the value of ${key} for the ${name} environment?`,
      parse: (answer: string) => {
        const typed = answer.trim();
        if (typed === "") {
          return {
            ok: false,
            problem: `${key} cannot be empty`,
          } as const;
        }
        return key === "ZITADEL_URL"
          ? ZitadelRuntime.parse(typed)
          : ({
              ok: true,
              value: typed,
            } as const);
      },
    };
    const value = SECRET_KEYS.has(key)
      ? await options.ask.secret(question)
      : await options.ask.text(question);
    if (this.envFile === undefined) {
      await Project.envFile(join(options.cwd, Project.envFileName(name))).append(key, value);
    }
    return value;
  }

  /**
   * A server value as an origin.
   *
   * @param value - The value a source supplied.
   * @param source - Where it came from, for the error.
   * @returns The origin.
   * @throws {ZitadelError} `E_VALIDATION` naming where it came from.
   */
  private static originFrom(value: string, source: string): string {
    try {
      return ZitadelRuntime.origin(value);
    } catch (error) {
      throw new ZitadelError(
        "E_VALIDATION",
        `ZITADEL_URL from ${source} is not a valid server: ${value}`,
        {
          hint: `Fix or remove ZITADEL_URL in ${source}; it must be a URL such as https://api.zitadel.cloud.`,
          ...(error instanceof Error ? { details: { cause: error.message } } : {}),
        },
      );
    }
  }
}
