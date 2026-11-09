/**
 * Where the configuration is kept, and how a file is written there.
 */

import type {
  ConfigFile,
  ConfigKind,
  JsonObject,
  StoredFile,
  UnparsedFile,
} from "@/lib/zitadel/types";

/**
 * Every way a file can be written: `create` refuses to replace one that is
 * already there, so a scaffold never overwrites a developer's file by
 * accident; `replace` writes over it.
 */
export const WRITE_MODES = ["create", "replace"] as const;

/**
 * How a file is written.
 */
export type WriteMode = (typeof WRITE_MODES)[number];

/**
 * Every way to treat a `$file` reference whose file is not there: `throw`
 * refuses it, `omit` leaves its value out.
 */
export const MISSING_REFERENCES = ["throw", "omit"] as const;

/**
 * What to do with a `$file` reference whose file is not there.
 */
export type MissingReference = (typeof MISSING_REFERENCES)[number];

/**
 * The part of `node:fs` a store uses, so the same store can run over a disk
 * or over memory.
 *
 * @remarks
 * Narrow on purpose: `node:fs` and an in-memory filesystem both satisfy it,
 * and nothing else about either is visible to the store. A read may answer
 * with a string or a buffer, and a directory listing with its names, as `memfs`
 * types them; the store turns each into text.
 */
export interface FileSystem {
  /**
   * The calls that wait.
   */
  readonly promises: {
    /**
     * Read a file as text.
     *
     * @param path - The absolute path.
     * @param encoding - The text encoding.
     * @returns Its text.
     */
    readFile(path: string, encoding: "utf8"): Promise<string | Buffer>;

    /**
     * List the names in a directory.
     *
     * @param path - The absolute path.
     * @returns The names.
     */
    readdir(path: string): Promise<readonly unknown[]>;

    /**
     * Check that a path can be reached.
     *
     * @param path - The absolute path.
     * @returns Nothing, when it can.
     */
    access(path: string): Promise<void>;

    /**
     * Make a directory and the ones above it that are missing.
     *
     * @param path - The absolute path.
     * @param options - Make the missing ones too.
     * @returns Nothing of use.
     */
    mkdir(path: string, options: { readonly recursive: true }): Promise<unknown>;

    /**
     * Write a file's text.
     *
     * @param path - The absolute path.
     * @param data - What it holds.
     * @param options - The open flag, such as `wx` to refuse an existing file.
     * @returns Nothing, once it is written.
     */
    writeFile(path: string, data: string, options: { readonly flag: string }): Promise<void>;

    /**
     * Remove a file.
     *
     * @param path - The absolute path.
     * @param options - Take a file that is not there as removed.
     * @returns Nothing, once it is gone.
     */
    rm(path: string, options: { readonly force: true }): Promise<void>;
  };

  /**
   * Read a file as text, waiting for nothing.
   *
   * @param path - The absolute path.
   * @param encoding - The text encoding.
   * @returns Its text.
   */
  readFileSync(path: string, encoding: "utf8"): string | Buffer;

  /**
   * Check whether a path exists.
   *
   * @param path - The absolute path.
   * @returns Whether it does.
   */
  existsSync(path: string): boolean;

  /**
   * Describe a path without following a symlink.
   *
   * @param path - The absolute path.
   * @returns Whether it is a symlink.
   */
  lstatSync(path: string): { isSymbolicLink(): boolean };

  /**
   * Describe a path, following a symlink.
   *
   * @param path - The absolute path.
   * @returns Whether it is a directory.
   */
  statSync(path: string): { isDirectory(): boolean };

  /**
   * Resolve a path with every symlink on it.
   *
   * @param path - The absolute path.
   * @returns The real path.
   */
  realpathSync(path: string): string | Buffer;
}

/**
 * Where the configuration is kept.
 *
 * @remarks
 * The library never touches a disk itself: the caller hands it a store, and a
 * test hands it one that holds the files in memory. An `interface`, not a
 * `type`, and the one in the library: it is a behavioural contract, not a
 * shape of data. {@link Store} implements it, over a disk or over memory.
 */
export interface ConfigStore {
  /**
   * Read every `*.json` file of one kind.
   *
   * @param kind - The kind of file to read.
   * @returns The files, in file-name order; one that is not valid JSON, or
   *   holds something other than a JSON object, comes back as an
   *   {@link UnparsedFile} with the reason, so it never hides the rest.
   * @throws {@link ConfigError} When a file cannot be read at all.
   */
  read(kind: ConfigKind): Promise<readonly StoredFile[]>;

  /**
   * Check whether a file is there, without reading it: a file that does not
   * parse is still there.
   *
   * @param path - The project-relative path.
   * @returns Whether it exists.
   */
  exists(path: string): Promise<boolean>;

  /**
   * Check that a file may be written, without touching it.
   *
   * @remarks
   * Every write enforces this itself; asking first lets a caller that writes
   * several files refuse all of them before the first is written.
   *
   * @param path - The project-relative path.
   * @throws {@link ConfigError} When the path leads outside `.zitadel/`, or a
   *   directory it needs is a file.
   */
  assertWritable(path: string): void;

  /**
   * Check that a file may be removed, without touching it.
   *
   * @remarks
   * Every removal enforces this itself. A file with a regular file on the way
   * is not there, so removing it is not refused.
   *
   * @param path - The project-relative path.
   * @throws {@link ConfigError} When the path leads outside `.zitadel/`.
   */
  assertRemovable(path: string): void;

  /**
   * Write one file's body.
   *
   * @param file - The file to write.
   * @param mode - Whether an existing file may be replaced.
   * @returns Nothing, once the file is written.
   * @throws {@link FileExistsError} When the file is already there, under
   *   `create`.
   * @throws {@link ConfigError} When the path leads outside `.zitadel/`, or a
   *   directory it needs is a file.
   */
  write(file: ConfigFile, mode: WriteMode): Promise<void>;

  /**
   * Delete one file. A file that is not there is already deleted.
   *
   * @param path - The project-relative path.
   * @returns Nothing, once the file is gone.
   */
  remove(path: string): Promise<void>;

  /**
   * Write a file a configuration file references, such as branding's template.
   *
   * @param path - The project-relative path.
   * @param text - What it holds.
   * @param mode - Whether an existing file may be replaced.
   * @returns Nothing, once the file is written.
   * @throws {@link FileExistsError} When the file is already there, under
   *   `create`.
   * @throws {@link ConfigError} When the path leads outside `.zitadel/`, or a
   *   directory it needs is a file.
   */
  writeText(path: string, text: string, mode: WriteMode): Promise<void>;

  /**
   * Inline every `{ "$file": "./x" }` reference of a body with the text of the
   * file it names, resolved against the directory of the file the body is
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
   * List the project-relative paths a file's `$file` references point at.
   *
   * @param file - The file.
   * @returns The paths, spelled with `/`.
   * @throws {@link ConfigError} When a reference leads outside the project.
   */
  listReferencedPaths(file: ConfigFile): readonly string[];
}
