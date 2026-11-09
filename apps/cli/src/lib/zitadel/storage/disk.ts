import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { access, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { stringify } from "safe-stable-stringify";

import { ConfigError, FileExistsError } from "@/lib/zitadel/errors";
import { CONFIG_DIRECTORIES, type ConfigFile, type ConfigKind, type JsonObject } from "@/lib/zitadel/types";
import type { ConfigStore, MissingReference, WriteMode } from "@/lib/zitadel/storage/types";
import { findFileReferences, inlineFileReferences } from "@/lib/zitadel/utils/references";
import { isJsonObject } from "@/lib/zitadel/utils/json";

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
  private readonly root: string;

  /**
   * Whether a file is there, without reading it.
   *
   * @param path - The project-relative path.
   * @returns Whether it exists.
   */
  async exists(path: string): Promise<boolean> {
    return access(join(this.root, path)).then(
      () => {
        return true;
      },
      () => {
        return false;
      },
    );
  }

  /**
   * @param root - The project's root directory.
   */
  constructor(root: string) {
    this.root = root;
  }

  async read(kind: ConfigKind): Promise<readonly ConfigFile[]> {
    const directory = CONFIG_DIRECTORIES[kind];
    const names = await readdir(join(this.root, directory)).catch((error: unknown) => {
      // Only an absent directory means the project has none: a permission
      // failure reported as "no files" would hide a file that is right there.
      if (errnoOf(error) === "ENOENT") {
        return [];
      }
      throw error;
    });
    const files = names
      .filter((name) => {
        return name.endsWith(".json");
      })
      .sort();
    return Promise.all(
      files.map(async (name) => {
        const path = `${directory}/${name}`;
        return { path, body: await this.parse(path) };
      }),
    );
  }

  async write(file: ConfigFile, mode: WriteMode): Promise<void> {
    const target = join(this.root, file.path);
    await mkdir(dirname(target), { recursive: true });
    const text = `${stringify(file.body, null, 2) ?? "null"}\n`;
    await writeFile(target, text, mode === "create" ? { flag: "wx" } : {}).catch(
      (error: unknown) => {
        if (errnoOf(error) === "EEXIST") {
          throw new FileExistsError(file.path);
        }
        throw error;
      },
    );
  }

  async remove(path: string): Promise<void> {
    await rm(join(this.root, path), { force: true });
  }

  async writeText(path: string, text: string, mode: WriteMode): Promise<void> {
    const target = join(this.root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text, mode === "create" ? { flag: "wx" } : {}).catch(
      (error: unknown) => {
        if (errnoOf(error) === "EEXIST") {
          throw new FileExistsError(path);
        }
        throw error;
      },
    );
  }

  inlineReferences(file: ConfigFile, missing: MissingReference): JsonObject {
    return inlineFileReferences(
      file.body,
      (ref) => {
        return this.readReference(this.resolve(file, ref), ref);
      },
      missing,
    );
  }

  referencedPaths(file: ConfigFile): readonly string[] {
    return findFileReferences(file.body).map(({ ref }) => {
      return relative(this.root, this.resolve(file, ref));
    });
  }

  /**
   * One file's body.
   *
   * @param path - The project-relative path.
   * @returns The parsed body.
   * @throws {@link ConfigError} Naming the file when it is not a JSON object.
   */
  private async parse(path: string): Promise<JsonObject> {
    const body: unknown = await readFile(join(this.root, path), "utf8")
      .then((text): unknown => {
        return JSON.parse(text);
      })
      .catch((error: unknown) => {
        throw new ConfigError(`${path} is not valid JSON`, {
          hint: "Fix the file, then run the command again.",
          details: { file: path, parse_error: parseErrorOf(error) },
        });
      });
    if (!isJsonObject(body)) {
      throw new ConfigError(`${path} does not contain a JSON object`, { details: { file: path } });
    }
    return body;
  }

  /**
   * The absolute path a reference names, resolved against the directory of the
   * file holding it.
   *
   * @param file - The file holding the reference.
   * @param ref - The reference as written.
   * @returns The absolute path.
   * @throws {@link ConfigError} When the path, or the real target behind any
   *   symlink on the way, leaves the project.
   */
  private resolve(file: ConfigFile, ref: string): string {
    const absolute = resolve(this.root, dirname(file.path), ref);
    const root = realTarget(resolve(this.root));
    const target = realTarget(absolute);
    const inside =
      isWithin(resolve(this.root), absolute) &&
      root !== undefined &&
      target !== undefined &&
      isWithin(root, target);
    if (!inside) {
      throw new ConfigError(`$file ${JSON.stringify(ref)} points outside the project`, {
        hint:
          "Keep referenced files inside the project, next to the file that references them; " +
          "a symlink on the way must resolve inside the project too.",
      });
    }
    return absolute;
  }

  /**
   * The text of a referenced file.
   *
   * @param path - The absolute path.
   * @param ref - The reference as written, for the message.
   * @returns The text, or `undefined` when there is no such file.
   * @throws {@link ConfigError} When the file is there but cannot be read.
   */
  private readReference(path: string, ref: string): string | undefined {
    try {
      return readFileSync(path, "utf8");
    } catch (error) {
      const code = errnoOf(error);
      if (code === "ENOENT" || code === "ENOTDIR") {
        return undefined;
      }
      throw new ConfigError(`$file ${JSON.stringify(ref)} cannot be read`, {
        hint: "Create the referenced file or fix the path.",
      });
    }
  }
}

/**
 * The error code of a failed file operation.
 *
 * @param error - What the operation threw.
 * @returns Its code, such as `ENOENT`, or `undefined`.
 */
function errnoOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

/**
 * What went wrong parsing a file, without the text of the file: V8 quotes the
 * source it choked on, and a connection file is where a pasted secret would be.
 *
 * @param error - What `JSON.parse` threw.
 * @returns A description that holds no file content.
 */
function parseErrorOf(error: unknown): string {
  const position = error instanceof Error ? /position (\d+)/.exec(error.message)?.[1] : undefined;
  if (position === undefined) {
    return "invalid JSON";
  }
  return `invalid JSON at position ${position}`;
}

/**
 * Whether a path is the root itself or lies beneath it.
 *
 * @param root - The root.
 * @param path - The path.
 * @returns Whether it is inside.
 */
function isWithin(root: string, path: string): boolean {
  const rel = relative(root, path);
  return !(rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel));
}

/**
 * A path with every symlink resolved, symlinked parent directories included,
 * even when its last segments do not exist yet.
 *
 * @param path - The path.
 * @returns The real path, or `undefined` when a segment is a symlink that
 *   resolves nowhere, since what it names could be anywhere.
 */
function realTarget(path: string): string | undefined {
  // Each directory on the way up, nearest first, until one exists.
  for (const directory of ancestorsOf(path)) {
    try {
      return join(realpathSync(directory), relative(directory, path));
    } catch (error) {
      const code = errnoOf(error);
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        throw error;
      }
      if (lstatSync(directory, { throwIfNoEntry: false })?.isSymbolicLink() === true) {
        return undefined;
      }
    }
  }
  return path;
}

/**
 * A path and every directory above it, nearest first.
 *
 * @param path - The path.
 * @returns The path, its parent, and so on up to the filesystem root.
 */
function ancestorsOf(path: string): string[] {
  const parent = dirname(path);
  if (parent === path) {
    return [path];
  }
  return [path, ...ancestorsOf(parent)];
}
