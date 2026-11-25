import { Project } from "@/lib/project";

import { EnvironmentNameInvalidError } from "./errors";
import type { Resolved } from "./types";

/** The environment names a platform build announces, by the variable it sets. */
const PLATFORM_SIGNALS: ReadonlyArray<{
  variable: string;
  /** Set only inside that platform's build, for a signal whose name is too generic to trust alone. */
  platform?: string;
  name: (value: string) => string;
}> = [
  {
    variable: "VERCEL_ENV",
    name: (value) => {
      return value;
    },
  },
  {
    variable: "CONTEXT",
    platform: "NETLIFY",
    name: (value) => {
      if (value === "deploy-preview" || value === "branch-deploy") {
        return "preview";
      }
      return value === "dev" ? "development" : value;
    },
  },
];

/**
 * An environment name is interpolated into the `.env.<name>.local` paths the
 * chain reads and writes, so a name carrying a slash or `..` would let a value
 * from `--env` or `ZITADEL_ENV` escape the project directory. Only a
 * conservative charset is allowed: letters, digits, dot, dash, underscore.
 */
const NAME_CHARACTERS = /^[A-Za-z0-9._-]+$/;

/** What an environment is called, where the name came from, and which files it reads. */
export class EnvironmentName implements Resolved {
  /** The name. */
  readonly value: string;

  /** What named it: a flag, a variable, or the default. */
  readonly source: string;

  private constructor(parts: Resolved) {
    this.value = parts.value;
    this.source = parts.source;
  }

  /**
   * Whether a value is usable as an environment name: the rule the
   * `.env.<name>.local` paths require, shared with `env add` so a name `--env`
   * resolves can also be bound. A `..` sequence is refused outright, and so is
   * `local`, since `.env.local` is setup's development file, and a name ending
   * in `.local`, which would read another environment's `.local` file.
   *
   * @param value - The name to check.
   * @returns `true` when it can be used in a path.
   */
  static isValid(value: string): boolean {
    return (
      NAME_CHARACTERS.test(value) &&
      !value.includes("..") &&
      value !== "local" &&
      !value.endsWith(".local")
    );
  }

  /**
   * Which environment this invocation is in: `--env`, `ZITADEL_ENV`, a hosting
   * platform's own signal, else `development`. `NODE_ENV` is not consulted:
   * platforms set it to `production` for every build, previews included.
   *
   * @param env - The process environment.
   * @param flag - The `--env` flag, when given.
   * @returns The name, and the source that named it.
   * @throws {@link EnvironmentNameInvalidError} When the name is not usable in a path.
   */
  static resolve(env: NodeJS.ProcessEnv, flag?: string): EnvironmentName {
    const name = new EnvironmentName(EnvironmentName.detect(env, flag));
    if (!EnvironmentName.isValid(name.value)) {
      throw new EnvironmentNameInvalidError(
        `${name.value} is not a valid environment name`,
        name.source,
      );
    }
    return name;
  }

  /**
   * The dotenv files read for an environment, highest priority first.
   * `.env.local` is setup's development project, so only the development
   * environment reads it: another name falling through to it would quietly
   * address the development project.
   *
   * @param setupFiles - Whether the files setup created are read.
   * @returns The files' names, in the project's root.
   */
  files(setupFiles: boolean): readonly string[] {
    return [
      Project.envFileName(this.value),
      ...(setupFiles ? [".env.local"] : []),
      `.env.${this.value}`,
      ".env",
    ];
  }

  /**
   * The name as the flag, the environment or a platform gave it, unchecked.
   *
   * @param env - The process environment.
   * @param flag - The `--env` flag, when given.
   * @returns The name, and the source that named it.
   */
  private static detect(env: NodeJS.ProcessEnv, flag?: string): Resolved {
    if (flag) {
      return { value: flag, source: "--env" };
    }
    if (env.ZITADEL_ENV) {
      return { value: env.ZITADEL_ENV, source: "ZITADEL_ENV" };
    }
    for (const signal of PLATFORM_SIGNALS) {
      const value = env[signal.variable];
      if (value && (signal.platform === undefined || env[signal.platform] === "true")) {
        return { value: signal.name(value), source: signal.variable };
      }
    }
    return { value: "development", source: "default" };
  }
}
