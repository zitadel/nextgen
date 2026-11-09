/**
 * Where the configuration is kept, and how a file is written there.
 */

import type { ConfigFile, ConfigKind, JsonObject } from "@/lib/zitadel/types";

/**
 * How a file is written: `create` refuses to replace one that is already
 * there, so a scaffold never overwrites a developer's file by accident;
 * `replace` writes over it.
 */
export type WriteMode = "create" | "replace";

/**
 * What to do with a `$file` reference whose file is not there: `throw`
 * refuses it, `omit` leaves its value out.
 */
export type MissingReference = "throw" | "omit";

/**
 * Where the configuration is kept.
 *
 * @remarks
 * The library never touches a disk itself: the caller hands it a store, and a
 * test hands it one that holds the files in memory.
 */
export interface ConfigStore {
  /**
   * Every `*.json` file of one kind.
   *
   * @param kind - The kind of file to read.
   * @returns The files, in file-name order.
   * @throws {@link ConfigError} When a file cannot be taken as a JSON object.
   */
  read(kind: ConfigKind): Promise<readonly ConfigFile[]>;

  /**
   * Whether a file is there, without reading it: a file that does not parse
   * is still there.
   *
   * @param path - The project-relative path.
   * @returns Whether it exists.
   */
  exists(path: string): Promise<boolean>;

  /**
   * Write one file's body.
   *
   * @param file - The file to write.
   * @param mode - Whether an existing file may be replaced.
   * @throws {@link FileExistsError} When the file is already there, under
   *   `create`.
   */
  write(file: ConfigFile, mode: WriteMode): Promise<void>;

  /**
   * Delete one file. A file that is not there is already deleted.
   *
   * @param path - The project-relative path.
   */
  remove(path: string): Promise<void>;

  /**
   * Write a file a configuration file references, such as branding's template.
   *
   * @param path - The project-relative path.
   * @param text - What it holds.
   * @param mode - Whether an existing file may be replaced.
   * @throws {@link FileExistsError} When the file is already there, under
   *   `create`.
   */
  writeText(path: string, text: string, mode: WriteMode): Promise<void>;

  /**
   * A body with every `{ "$file": "./x" }` reference replaced by the text of
   * the file it names, resolved against the directory of the file the body is
   * from.
   *
   * @param file - The file whose references to resolve.
   * @param missing - What to do with a reference whose file is not there.
   * @returns The body with its references inlined.
   * @throws {@link ConfigError} When a reference leads outside the project,
   *   or cannot be read under `throw`.
   */
  inlineReferences(file: ConfigFile, missing: MissingReference): JsonObject;

  /**
   * The project-relative paths a file's `$file` references point at.
   *
   * @param file - The file.
   * @returns The paths, spelled with `/`.
   * @throws {@link ConfigError} When a reference leads outside the project.
   */
  referencedPaths(file: ConfigFile): readonly string[];
}
