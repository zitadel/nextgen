import { dirname, posix } from "node:path";

import { FileExistsError } from "@/lib/zitadel/errors";
import {
  CONFIG_DIRECTORIES,
  type ConfigFile,
  type ConfigKind,
  type ConfigStore,
  type JsonObject,
  type MissingReference,
  type WriteMode,
} from "@/lib/zitadel/types";
import { findFileReferences, inlineFileReferences } from "@/lib/zitadel/utils/references";

/**
 * The configuration held in memory: what a test hands the library instead of
 * a disk, and reads back to see what was written.
 *
 * @remarks
 * A store is the one stateful thing here, by nature: writing to it changes
 * what it holds, as writing to a disk would.
 */
export class MemoryStore implements ConfigStore {
  private readonly files: Map<string, JsonObject>;
  private readonly assets: Map<string, string>;

  /**
   * @param files - The configuration files it starts with.
   * @param assets - Other files a `$file` reference may name, by project-relative path.
   */
  constructor(files: readonly ConfigFile[] = [], assets: Readonly<Record<string, string>> = {}) {
    this.files = new Map(
      files.map((file) => {
        return [file.path, file.body];
      }),
    );
    this.assets = new Map(Object.entries(assets));
  }

  async read(kind: ConfigKind): Promise<readonly ConfigFile[]> {
    const directory = CONFIG_DIRECTORIES[kind];
    return [...this.files]
      .filter(([path]) => {
        return dirname(path) === directory && path.endsWith(".json");
      })
      .sort(([a], [b]) => {
        return a < b ? -1 : 1;
      })
      .map(([path, body]) => {
        return { path, body };
      });
  }

  async write(file: ConfigFile, mode: WriteMode): Promise<void> {
    if (mode === "create" && this.files.has(file.path)) {
      throw new FileExistsError(file.path);
    }
    this.files.set(file.path, file.body);
  }

  async writeText(path: string, text: string, mode: WriteMode): Promise<void> {
    if (mode === "create" && this.assets.has(path)) {
      throw new FileExistsError(path);
    }
    this.assets.set(path, text);
  }

  inlineReferences(file: ConfigFile, missing: MissingReference): JsonObject {
    return inlineFileReferences(
      file.body,
      (ref) => {
        return this.assets.get(resolved(file, ref));
      },
      missing,
    );
  }

  referencedPaths(file: ConfigFile): readonly string[] {
    return findFileReferences(file.body).map(({ ref }) => {
      return resolved(file, ref);
    });
  }

  /**
   * What the store holds at a path, for a test to assert on.
   *
   * @param path - The project-relative path.
   * @returns The body, or `undefined` when nothing is there.
   */
  get(path: string): JsonObject | undefined {
    return this.files.get(path);
  }
}

/**
 * The project-relative path a reference names, resolved against the directory
 * of the file holding it.
 *
 * @param file - The file holding the reference.
 * @param ref - The reference as written.
 * @returns The path.
 */
function resolved(file: ConfigFile, ref: string): string {
  return posix.normalize(posix.join(posix.dirname(file.path), ref));
}
