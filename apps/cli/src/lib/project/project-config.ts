import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ZitadelError } from "@/lib/errors";
import { isErrno } from "@/lib/errno";
import { pathExistsStrict } from "@/lib/fs";
import { isObject, parseJsonObject } from "@/lib/json";

/**
 * A project's `zitadel.json`: the committed record of how setup configured it.
 * It is read as a plain object, so a key setup does not know of survives, and
 * each question the CLI asks of it has an answer here.
 */
export class ProjectConfig {
  /** The parsed file, every key it holds. */
  readonly data: Readonly<Record<string, unknown>>;

  /**
   * @param data - What `zitadel.json` holds.
   */
  constructor(data: Readonly<Record<string, unknown>> = {}) {
    this.data = data;
  }

  /**
   * Whether `cwd` has already been initialized, that is, a committed
   * `zitadel.json` exists. Decides whether setup should run or skip.
   *
   * @param cwd - The project's directory.
   * @returns `true` when the file exists.
   */
  static async exists(cwd: string): Promise<boolean> {
    return pathExistsStrict(join(cwd, "zitadel.json"));
  }

  /**
   * Reads and parses `zitadel.json`. A missing file becomes an actionable
   * `E_VALIDATION` error pointing at `setup`; other errors (malformed JSON)
   * propagate unchanged.
   *
   * @param cwd - The project's directory.
   * @returns The project's configuration.
   * @throws {@link ZitadelError} When there is no `zitadel.json`.
   */
  static async read(cwd: string): Promise<ProjectConfig> {
    try {
      return new ProjectConfig(
        parseJsonObject(await readFile(join(cwd, "zitadel.json"), "utf8"), "zitadel.json"),
      );
    } catch (error) {
      if (isErrno(error, "ENOENT")) {
        throw new ZitadelError("E_VALIDATION", "zitadel.json was not found", {
          hint: "Set the project up first.",
          nextCommands: [{ id: "setup" }],
        });
      }
      throw error;
    }
  }

  /**
   * The framework setup recorded.
   *
   * @returns Its id, or `undefined` when the file names none.
   */
  get frameworkId(): string | undefined {
    const id = isObject(this.data.framework) ? this.data.framework.id : undefined;
    return typeof id === "string" ? id : undefined;
  }

  /**
   * The configured renderer id, with the legacy `default` alias read as `react`
   * and `react` when unset. `getRenderer` validates the value downstream, so
   * callers need not re-check it.
   *
   * @returns The renderer's id.
   */
  get rendererId(): string {
    const branding = isObject(this.data.branding) ? this.data.branding : undefined;
    const value = branding && typeof branding.renderer === "string" ? branding.renderer : "react";
    return value === "default" ? "react" : value;
  }

  /**
   * The sign-in preset setup recorded; absent means password-first, the setup
   * default.
   *
   * @returns The preset, or `undefined` when none was recorded.
   */
  get preset(): string | undefined {
    return typeof this.data.preset === "string" ? this.data.preset : undefined;
  }

  /**
   * The use case setup recorded. It is guidance only, like the field itself:
   * behaviour lives in the generated schema and flow files.
   *
   * @returns The use case, or `undefined` when none was recorded.
   */
  get useCase(): string | undefined {
    return typeof this.data.useCase === "string" ? this.data.useCase : undefined;
  }

  /**
   * The top-level `server` origin, or `undefined` when the key is absent, in which
   * case the project is on the default server and the command says which that is.
   *
   * This is the server the project actually lives on, which is not always the
   * one a command is talking to: `doctor` pins its own source to the local
   * runtime URL and `status --server local` overrides it. Anything reasoning
   * about the project itself, rather than about this invocation, reads it from
   * here.
   *
   * @returns The server's origin, if the file names one.
   */
  get server(): string | undefined {
    if (typeof this.data.server === "string") {
      return this.data.server;
    }
    return undefined;
  }
}
