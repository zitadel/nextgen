import { parseEnv } from "node:util";

import { readIfExists } from "@/lib/fs";

import { ENVIRONMENT_KEYS } from "./keys";
import type { Values } from "./types";

/**
 * A dotenv file, read for the keys an environment cares about. Parsed with
 * `node:util`'s `parseEnv`, which is why this stays separate from the local
 * runtime's loader in `local-server/env-vars.ts`: that one is hard-coded to
 * its own keys.
 */
export class Dotenv {
  /** Where it is. */
  readonly path: string;

  private constructor(path: string) {
    this.path = path;
  }

  /**
   * The dotenv file at a path, which need not exist.
   *
   * @param path - The file's path.
   * @returns The file.
   */
  static at(path: string): Dotenv {
    return new Dotenv(path);
  }

  /**
   * The keys an environment cares about, with a value, out of a bag of
   * variables.
   *
   * @param values - Any variables, such as `process.env`.
   * @returns Only the environment's own keys that are set and not empty.
   */
  static pick(values: Readonly<Record<string, string | undefined>>): Values {
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
   * Reads the keys an environment cares about from the file.
   *
   * @returns The keys it holds, or `undefined` when the file does not exist.
   * @throws Any read error other than a missing file.
   */
  async read(): Promise<Values | undefined> {
    const text = await readIfExists(this.path);
    return text === undefined ? undefined : Dotenv.pick(parseEnv(text));
  }
}
