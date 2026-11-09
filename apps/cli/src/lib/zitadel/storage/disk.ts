import { readFileSync } from "node:fs";
import { access, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";

import { stringify } from "safe-stable-stringify";

import { ConfigError, FileExistsError } from "@/lib/zitadel/errors";
import {
  CONFIG_DIRECTORIES,
  type ConfigFile,
  type ConfigKind,
  type JsonObject,
} from "@/lib/zitadel/types";
import { Path } from "@/lib/zitadel/storage/path";
import {
  findFileReferences,
  inlineFileReferences,
  outsideProject,
} from "@/lib/zitadel/storage/references";
import type { ConfigStore, MissingReference, WriteMode } from "@/lib/zitadel/storage/types";
import { isJsonObject, isJsonValue } from "@/lib/zitadel/utils/json";

/**
 * The flag `writeFile` opens a file with, by how it is written.
 */
const WRITE_FLAG = {
  create: "wx",
  replace: "w",
} as const satisfies Record<WriteMode, string>;

/**
 * The configuration as files on disk, under a project's `.zitadel/`.
 *
 * @remarks
 * Only `*.json` files count, so a README beside them is never read. A file
 * that cannot be parsed stops the run: editing one that could not be read is
 * how a working setup gets corrupted. Files are written with their keys sorted
 * at every depth, so a rewrite that changes nothing changes no byte. A `$file`
 * reference must stay inside the project, because a deploy uploads what it
 * names: a path, or a symlink on the way, that leads outside is refused.
 */
export class DiskStore implements ConfigStore {
  /**
   * The project's root directory, which every path given to the store is
   * relative to.
   */
  private readonly root: Path;

  /**
   * A store over one project's files.
   *
   * @param root - The project's root directory.
   */
  constructor(root: string) {
    this.root = Path.of(root);
  }

  /**
   * Read every `*.json` file of one kind, parsed.
   *
   * @param kind - The kind of file to read.
   * @returns The files, in file-name order; none when the kind's directory is
   *   not there.
   * @throws {@link ConfigError} When a file is not valid JSON, or holds
   *   something other than a JSON object.
   */
  async read(kind: ConfigKind): Promise<readonly ConfigFile[]> {
    const directory = CONFIG_DIRECTORIES[kind];
    const names = await readdir(this.root.resolve(directory).toString()).catch((error: unknown) => {
      // Only an absent directory means the project has none: a permission
      // failure reported as "no files" would hide a file that is right there.
      if (DiskStore.errnoOf(error) === "ENOENT") {
        return [];
      }
      throw error;
    });
    // The filter makes a fresh list, so sorting it changes nothing anyone else holds.
    const files = names
      .filter((name) => {
        return name.endsWith(".json");
      })
      .sort();
    return Promise.all(
      files.map(async (name): Promise<ConfigFile> => {
        const path = `${directory}/${name}`;
        const body = await DiskStore.readJson(this.root.resolve(path).toString(), path);
        if (!isJsonValue(body) || !isJsonObject(body)) {
          throw new ConfigError(`${path} does not contain a JSON object`, {
            details: { file: path },
          });
        }
        return { path, body };
      }),
    );
  }

  /**
   * Check whether a file is there, without reading it.
   *
   * @param path - The project-relative path.
   * @returns Whether it exists.
   * @throws The access error, when it is anything but the file or one of its
   *   directories being absent: a permission failure is not "absent".
   */
  async exists(path: string): Promise<boolean> {
    return access(this.root.resolve(path).toString()).then(
      () => {
        return true;
      },
      (error: unknown) => {
        const code = DiskStore.errnoOf(error);
        if (code === "ENOENT" || code === "ENOTDIR") {
          return false;
        }
        throw error;
      },
    );
  }

  /**
   * Write one file's body as JSON with its keys sorted, creating the
   * directories it needs.
   *
   * @param file - The file to write.
   * @param mode - Whether an existing file may be replaced.
   * @returns Nothing, once the file is written.
   * @throws {@link FileExistsError} When the file is already there, under
   *   `create`.
   */
  async write(file: ConfigFile, mode: WriteMode): Promise<void> {
    const json = stringify(file.body, null, 2) ?? "null";
    return this.writeText(file.path, `${json}\n`, mode);
  }

  /**
   * Delete one file. A file that is not there is already deleted.
   *
   * @param path - The project-relative path.
   * @returns Nothing, once the file is gone.
   */
  async remove(path: string): Promise<void> {
    await rm(this.root.resolve(path).toString(), { force: true });
  }

  /**
   * Write a file's text as given, creating the directories it needs.
   *
   * @param path - The project-relative path.
   * @param text - What it holds.
   * @param mode - Whether an existing file may be replaced.
   * @returns Nothing, once the file is written.
   * @throws {@link FileExistsError} When the file is already there, under
   *   `create`.
   */
  async writeText(path: string, text: string, mode: WriteMode): Promise<void> {
    const target = this.root.resolve(path);
    await mkdir(target.parent.toString(), { recursive: true });
    await writeFile(target.toString(), text, { flag: WRITE_FLAG[mode] }).catch((error: unknown) => {
      if (DiskStore.errnoOf(error) === "EEXIST") {
        throw new FileExistsError(path);
      }
      throw error;
    });
  }

  /**
   * Inline every `$file` reference of a body with the text of the file it
   * names, read from disk.
   *
   * @param file - The file whose references to resolve.
   * @param missing - What to do with a reference whose file is not there.
   * @returns The body with its references inlined.
   * @throws {@link ConfigError} When a reference leads outside the project,
   *   when its file is there but cannot be read, or when it is not there,
   *   under `throw`.
   */
  inlineReferences(file: ConfigFile, missing: MissingReference): JsonObject {
    return inlineFileReferences(
      file.body,
      (ref) => {
        const target = this.locate(file, ref);
        try {
          return readFileSync(target.toString(), "utf8");
        } catch (error) {
          // Only a file that is not there may be omitted; one that is there
          // but unreadable is refused, so a deploy never drops it silently.
          const code = DiskStore.errnoOf(error);
          if (code === "ENOENT" || code === "ENOTDIR") {
            return undefined;
          }
          throw new ConfigError(`$file ${JSON.stringify(ref)} cannot be read`, {
            hint: "Create the referenced file or fix the path.",
          });
        }
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
      return this.locate(file, item.ref).relativeTo(this.root);
    });
  }

  /**
   * Locate where a reference points, resolved against the directory of the
   * file holding it.
   *
   * @remarks
   * The path is checked as written and again with every symlink resolved, so
   * neither `..` nor a link on the way can reach outside the project.
   *
   * @param file - The file holding the reference.
   * @param ref - The reference as written.
   * @returns The path it names.
   * @throws {@link ConfigError} When the path, or the real target behind a
   *   symlink on the way, leaves the project.
   */
  private locate(file: ConfigFile, ref: string): Path {
    const target = this.root.resolve(file.path).parent.resolve(ref);
    const realRoot = this.root.resolveReal();
    const realTarget = target.resolveReal();
    if (
      !this.root.contains(target) ||
      realRoot === undefined ||
      realTarget === undefined ||
      !realRoot.contains(realTarget)
    ) {
      throw outsideProject(ref);
    }
    return target;
  }

  /**
   * Read and parse one file, where data enters the library.
   *
   * @remarks
   * Only the parser's position is kept: V8 quotes the source it choked on,
   * and a connection file is where a pasted secret would be.
   *
   * @param location - The file's absolute path.
   * @param path - The project-relative path, for the message.
   * @returns Whatever the text parses to.
   * @throws {@link ConfigError} When the file cannot be read, naming the error code,
   *   or is not valid JSON.
   */
  private static async readJson(location: string, path: string): Promise<unknown> {
    const text = await readFile(location, "utf8").catch((error: unknown) => {
      const code = DiskStore.errnoOf(error);
      throw new ConfigError(`${path} cannot be read${code === undefined ? "" : ` (${code})`}`, {
        hint: "Check that the file is readable, then run the command again.",
        details: {
          file: path,
          ...(code === undefined ? {} : { code }),
        },
      });
    });
    try {
      return JSON.parse(text);
    } catch (error) {
      const position =
        error instanceof Error ? /position (\d+)/.exec(error.message)?.[1] : undefined;
      const parseError =
        position === undefined ? "invalid JSON" : `invalid JSON at position ${position}`;
      throw new ConfigError(`${path} is not valid JSON`, {
        hint: "Fix the file, then run the command again.",
        details: {
          file: path,
          parse_error: parseError,
        },
      });
    }
  }

  /**
   * The error code of a failed file operation.
   *
   * @param error - What the operation threw.
   * @returns Its code, such as `ENOENT`, or `undefined` when it has none.
   */
  private static errnoOf(error: unknown): string | undefined {
    if (typeof error !== "object" || error === null || !("code" in error)) {
      return undefined;
    }
    if (typeof error.code !== "string") {
      return undefined;
    }
    return error.code;
  }
}
