import { sep } from "node:path";

import { FileExistsError } from "@/lib/zitadel/errors";
import {
  CONFIG_DIRECTORIES,
  type ConfigFile,
  type ConfigKind,
  type JsonObject,
  type StoredFile,
} from "@/lib/zitadel/types";
import { Path } from "@/lib/zitadel/storage/path";
import {
  CONFIG_ROOT,
  findFileReferences,
  inlineFileReferences,
  outsideConfig,
  outsideProject,
} from "@/lib/zitadel/storage/references";
import type { ConfigStore, MissingReference, WriteMode } from "@/lib/zitadel/storage/types";

/**
 * The directory an in-memory project stands in, so its references resolve
 * the way they would on disk.
 *
 * @remarks
 * Nothing is ever read from it. It is a directory below the filesystem root,
 * so a reference that climbs out of the project is caught, not clamped at the
 * root.
 */
const ROOT = Path.of(sep, "project");

/**
 * The configuration held in memory: what a test hands the library instead of
 * a disk, and reads back to see what was written.
 *
 * @remarks
 * A store is the one stateful thing here, by nature: writing to it changes
 * what it holds, as writing to a disk would.
 */
export class MemoryStore implements ConfigStore {
  /**
   * The configuration files, by project-relative path; a file that could not
   * be parsed is held as it is, without a body.
   */
  private readonly files: Map<string, StoredFile>;

  /**
   * Every other file, such as one a `$file` reference names, by
   * project-relative path.
   */
  private readonly assets: Map<string, string>;

  /**
   * A store that starts out holding the files given.
   *
   * @param files - The configuration files it starts with, among them any that
   *   could not be parsed.
   * @param assets - Other files a `$file` reference may name, by project-relative path.
   */
  constructor(files: readonly StoredFile[] = [], assets: { readonly [path: string]: string } = {}) {
    this.files = new Map(
      files.map((file) => {
        return [file.path, file];
      }),
    );
    this.assets = new Map(Object.entries(assets));
  }

  /**
   * Read every `*.json` configuration file of one kind that the store holds.
   *
   * @param kind - The kind of file to read.
   * @returns The files, in file-name order.
   */
  async read(kind: ConfigKind): Promise<readonly StoredFile[]> {
    const directory = ROOT.resolve(CONFIG_DIRECTORIES[kind]);
    return [...this.files]
      .filter((pair) => {
        const path = pair[0];
        return path.endsWith(".json") && ROOT.resolve(path).parent.equals(directory);
      })
      .sort((a, b) => {
        return a[0] < b[0] ? -1 : 1;
      })
      .map((pair) => {
        return pair[1];
      });
  }

  /**
   * Check whether a configuration file or another file is held.
   *
   * @param path - The project-relative path.
   * @returns Whether it is.
   */
  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.assets.has(path);
  }

  /**
   * Check that a file may be written or removed, as a disk would.
   *
   * @param path - The project-relative path.
   * @throws {@link ConfigError} When the path leads outside `.zitadel/`.
   */
  assertWritable(path: string): void {
    if (!ROOT.resolve(CONFIG_ROOT).contains(ROOT.resolve(path))) {
      throw outsideConfig(path);
    }
  }

  /**
   * Hold one configuration file's body.
   *
   * @param file - The file to write.
   * @param mode - Whether an existing file may be replaced.
   * @returns Nothing, once it is held.
   * @throws {@link FileExistsError} When anything is already held at the path,
   *   under `create`.
   * @throws {@link ConfigError} When the path leads outside `.zitadel/`.
   */
  async write(file: ConfigFile, mode: WriteMode): Promise<void> {
    this.assertWritable(file.path);
    if (mode === "create" && (await this.exists(file.path))) {
      throw new FileExistsError(file.path);
    }
    this.files.set(file.path, file);
  }

  /**
   * Stop holding one configuration file. A file not held is already deleted.
   *
   * @param path - The project-relative path.
   * @returns Nothing, once it is gone.
   * @throws {@link ConfigError} When the path leads outside `.zitadel/`.
   */
  async remove(path: string): Promise<void> {
    this.assertWritable(path);
    this.files.delete(path);
  }

  /**
   * Hold another file's text, such as a template a `$file` reference names.
   *
   * @param path - The project-relative path.
   * @param text - What it holds.
   * @param mode - Whether an existing file may be replaced.
   * @returns Nothing, once it is held.
   * @throws {@link FileExistsError} When anything is already held at the path,
   *   under `create`.
   * @throws {@link ConfigError} When the path leads outside `.zitadel/`.
   */
  async writeText(path: string, text: string, mode: WriteMode): Promise<void> {
    this.assertWritable(path);
    if (mode === "create" && (await this.exists(path))) {
      throw new FileExistsError(path);
    }
    this.assets.set(path, text);
  }

  /**
   * Inline every `$file` reference of a body with the text of the file it
   * names, from the files the store holds.
   *
   * @param file - The file whose references to resolve.
   * @param missing - What to do with a reference whose file is not held.
   * @returns The body with its references inlined.
   * @throws {@link ConfigError} When a reference leads outside the project,
   *   or when its file is not held, under `throw`.
   */
  inlineReferences(file: ConfigFile, missing: MissingReference): JsonObject {
    return inlineFileReferences(
      file.body,
      (ref) => {
        return this.assets.get(this.locate(file, ref));
      },
      missing,
    );
  }

  /**
   * List the project-relative paths a file's `$file` references point at.
   *
   * @param file - The file.
   * @returns The paths, spelled with `/`.
   * @throws {@link ConfigError} When a reference leads outside the project.
   */
  listReferencedPaths(file: ConfigFile): readonly string[] {
    return findFileReferences(file.body).map((item) => {
      return this.locate(file, item.ref);
    });
  }

  /**
   * Get what the store holds at a path, for a test to assert on.
   *
   * @param path - The project-relative path.
   * @returns The body, or `undefined` when nothing is there or the file there
   *   could not be parsed.
   */
  get(path: string): JsonObject | undefined {
    const file = this.files.get(path);
    if (file === undefined || "unparsed" in file) {
      return undefined;
    }
    return file.body;
  }

  /**
   * Locate where a reference points, resolved against the directory of the
   * file holding it.
   *
   * @param file - The file holding the reference.
   * @param ref - The reference as written.
   * @returns The project-relative path it names.
   * @throws {@link ConfigError} When the path leaves the project.
   */
  private locate(file: ConfigFile, ref: string): string {
    const target = ROOT.resolve(file.path).parent.resolve(ref);
    if (!ROOT.contains(target)) {
      throw outsideProject(ref);
    }
    return target.relativeTo(ROOT);
  }
}
