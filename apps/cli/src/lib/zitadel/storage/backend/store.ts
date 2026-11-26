import { stringify } from "safe-stable-stringify";

import { isErrno } from "@/lib/errno";
import {
  ZitadelConfigError,
  ZitadelConfigFileExistsError,
  ZitadelConfigFileUnreadableError,
  ZitadelConfigPathUnreadableError,
  ZitadelConfigReferenceUnreadableError,
} from "@/lib/zitadel/errors";
import {
  CONFIG_DIRECTORIES,
  type ConfigFile,
  type ConfigKind,
  type JsonObject,
  type StoredFile,
} from "@/lib/zitadel/types";
import type { Path } from "@/lib/zitadel/storage/path";
import { UnparsedFile } from "@/lib/zitadel/storage/unparsed-file";
import {
  CONFIG_ROOT,
  findFileReferences,
  inlineFileReferences,
} from "@/lib/zitadel/storage/references";
import type {
  ConfigStore,
  FileSystem,
  MissingReference,
  WriteMode,
} from "@/lib/zitadel/storage/types";
import { isJsonObject, isJsonValue } from "@/lib/zitadel/utils/json";

/**
 * The flag `writeFile` opens a file with, by how it is written.
 */
const WRITE_FLAG = {
  create: "wx",
  replace: "w",
} as const satisfies Record<WriteMode, string>;

/**
 * The configuration as files under a project's `.zitadel/`, kept in whatever
 * {@link FileSystem} it is given.
 *
 * @remarks
 * This is the whole store. {@link DiskStore} hands it the real filesystem and
 * a test an in-memory one, and neither adds behaviour of its own,
 * so a test over memory exercises the code that runs over a disk.
 *
 * Only `*.json` files count, so a README beside them is never read. A file
 * that cannot be read stops the run: editing one that could not be read is
 * how a working setup gets corrupted. A file that cannot be parsed is handed
 * on marked unparsed, so it is reported as the broken file it is and never
 * hides the rest. Files are written with their keys sorted at every depth, so
 * a rewrite that changes nothing changes no byte. A `$file` reference must
 * stay inside the project, because a deploy uploads what it names: a path, or
 * a symlink on the way, that leads outside is refused. Every file written or
 * removed must stay inside `.zitadel/`, by the same test.
 */
export abstract class Store implements ConfigStore {
  /**
   * Where the files are kept.
   */
  private readonly fs: FileSystem;

  /**
   * The project's root directory, which every path given to the store is
   * relative to.
   */
  private readonly root: Path;

  /**
   * A store over one project's files.
   *
   * @param fs - Where the files are kept.
   * @param root - The project's root directory in that filesystem.
   */
  protected constructor(fs: FileSystem, root: Path) {
    this.fs = fs;
    this.root = root;
  }

  /**
   * Read every `*.json` file of one kind, parsed.
   *
   * @param kind - The kind of file to read.
   * @returns The files, in file-name order; none when the kind's directory is
   *   not there. A file that is not valid JSON, or holds something other than
   *   a JSON object, comes back as an {@link UnparsedFile} with the reason.
   * @throws {@link ZitadelConfigFileUnreadableError} When the operating system
   *   refuses to let the directory or a file be read; of several files that
   *   cannot, the first in path order.
   * @throws {@link ZitadelConfigPathUnreadableError} When the directory or a
   *   file cannot be read for another reason.
   */
  async read(kind: ConfigKind): Promise<readonly StoredFile[]> {
    const directory = CONFIG_DIRECTORIES[kind];
    try {
      const names: readonly unknown[] = await this.fs.promises.readdir(
        this.root.resolve(directory).toString(),
      );
      // The filter makes a fresh list, so sorting it changes nothing anyone else holds.
      const files = names
        .map((name) => {
          return String(name);
        })
        .filter((name) => {
          return name.endsWith(".json");
        })
        .sort();
      // Every read settles before any failure is raised, and the first failure
      // in path order is the one raised, so which bad file is named never
      // depends on which read finished first.
      const readings = await Promise.all(
        files.map((name) => {
          return this.readFileAt(`${directory}/${name}`).catch((error: unknown) => {
            if (error instanceof ZitadelConfigError) {
              return error;
            }
            throw error;
          });
        }),
      );
      const failure = readings.find((reading) => {
        return reading instanceof ZitadelConfigError;
      });
      if (failure !== undefined) {
        throw failure;
      }

      return readings.filter((reading): reading is StoredFile => {
        return !(reading instanceof ZitadelConfigError);
      });
    } catch (error) {
      // Only an absent directory means the project has none: a permission
      // failure, or a file where the directory should be, reported as "no
      // files" would hide what is there and let a later write fail instead.
      if (error instanceof ZitadelConfigError) {
        throw error;
      }
      if (isErrno(error, "ENOENT")) {
        return [];
      }
      if (isErrno(error, "EACCES")) {
        throw new ZitadelConfigFileUnreadableError(directory, "EACCES", error);
      }
      if (isErrno(error, "EPERM")) {
        throw new ZitadelConfigFileUnreadableError(directory, "EPERM", error);
      }
      throw new ZitadelConfigPathUnreadableError(directory, Store.errnoOf(error), error);
    }
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
    try {
      await this.fs.promises.access(this.root.resolve(path).toString());
      return true;
    } catch (error) {
      if (isErrno(error, "ENOENT") || isErrno(error, "ENOTDIR")) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Check that a file may be written, without touching it.
   *
   * @param path - The project-relative path.
   * @throws {@link ZitadelConfigError} When the path, or the real target behind a
   *   symlink on the way, leaves `.zitadel/`, or a directory it needs is a file.
   */
  assertWritable(path: string): void {
    this.assertClear(path, this.place(path));
  }

  /**
   * Check that a file may be removed, without touching it.
   *
   * @param path - The project-relative path.
   * @throws {@link ZitadelConfigError} When the path, or the real target behind a
   *   symlink on the way, leaves `.zitadel/`, or it is a directory.
   */
  assertRemovable(path: string): void {
    this.removable(path);
  }

  /**
   * Write one file's body as JSON with its keys sorted, creating the
   * directories it needs.
   *
   * @param file - The file to write.
   * @param mode - Whether an existing file may be replaced.
   * @returns Nothing, once the file is written.
   * @throws {@link ZitadelConfigFileExistsError} When the file is already there, under
   *   `create`.
   * @throws {@link ZitadelConfigError} When the path leads outside `.zitadel/`, or a
   *   directory it needs is a file.
   */
  async write(file: ConfigFile, mode: WriteMode): Promise<void> {
    return this.writeText(file.path, Store.render(file.body), mode);
  }

  /**
   * Delete one file. A file that is not there is already deleted.
   *
   * @param path - The project-relative path.
   * @returns Nothing, once the file is gone.
   * @throws {@link ZitadelConfigError} When the path leads outside `.zitadel/`, or is
   *   a directory.
   */
  async remove(path: string): Promise<void> {
    try {
      await this.fs.promises.unlink(this.removable(path));
    } catch (error) {
      // A file that is not there, or a directory on the way that is a file,
      // is already removed.
      if (!isErrno(error, "ENOENT") && !isErrno(error, "ENOTDIR")) {
        throw error;
      }
    }
  }

  /**
   * Write a file's text as given, creating the directories it needs.
   *
   * @param path - The project-relative path.
   * @param text - What it holds.
   * @param mode - Whether an existing file may be replaced.
   * @returns Nothing, once the file is written.
   * @throws {@link ZitadelConfigFileExistsError} When the file is already there, under
   *   `create`.
   * @throws {@link ZitadelConfigError} When the path leads outside `.zitadel/`, or a
   *   directory it needs is a file.
   */
  async writeText(path: string, text: string, mode: WriteMode): Promise<void> {
    const target = this.place(path);
    this.assertClear(path, target);
    await this.fs.promises.mkdir(target.parent.toString(), { recursive: true });
    try {
      await this.fs.promises.writeFile(target.toString(), text, { flag: WRITE_FLAG[mode] });
    } catch (error) {
      if (isErrno(error, "EEXIST")) {
        throw new ZitadelConfigFileExistsError(path);
      }
      throw error;
    }
  }

  /**
   * Inline every `$file` reference of a body with the text of the file it
   * names.
   *
   * @param file - The file whose references to resolve.
   * @param missing - What to do with a reference whose file is not there.
   * @returns The body with its references inlined.
   * @throws {@link ZitadelConfigError} When a reference leads outside the project,
   *   when its file is there but cannot be read, or when it is not there,
   *   under `throw`.
   */
  inlineReferences(file: ConfigFile, missing: MissingReference): JsonObject {
    return inlineFileReferences(
      file.body,
      (ref) => {
        const target = this.locate(file, ref);
        try {
          return this.fs.readFileSync(target.toString(), "utf8").toString();
        } catch (error) {
          // Only a file that is not there may be omitted; one that is there
          // but unreadable is refused, so a deploy never drops it silently.
          if (isErrno(error, "ENOENT") || isErrno(error, "ENOTDIR")) {
            return undefined;
          }
          const message = `$file ${JSON.stringify(ref)} cannot be read; create the referenced file or fix the path`;
          if (isErrno(error, "EACCES") || isErrno(error, "EPERM")) {
            throw new ZitadelConfigReferenceUnreadableError(message, error);
          }
          throw new ZitadelConfigError(message, error);
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
   * @throws {@link ZitadelConfigError} When a reference leads outside the project.
   */
  listReferencedPaths(file: ConfigFile): readonly string[] {
    return findFileReferences(file.body).map((item) => {
      return this.locate(file, item.ref).relativeTo(this.root);
    });
  }

  /**
   * A body as the text a file holds: JSON with its keys sorted at every depth,
   * and a final newline.
   *
   * @param body - The body.
   * @returns The text.
   */
  static render(body: JsonObject): string {
    return `${stringify(body, null, 2) ?? "null"}\n`;
  }

  /**
   * Place a file the store writes or removes, inside `.zitadel/`.
   *
   * @remarks
   * Checked as written and again with every symlink resolved, so neither a
   * `..` in a path built from a server-supplied name nor a link on the way
   * can reach outside the directory the configuration lives in.
   *
   * @param path - The project-relative path.
   * @returns The path to touch.
   * @throws {@link ZitadelConfigError} When the path, or the real target behind a
   *   symlink on the way, leaves `.zitadel/`.
   */
  private place(path: string): Path {
    const directory = this.root.resolve(CONFIG_ROOT);
    const target = this.root.resolve(path);
    const realDirectory = directory.resolveReal(this.fs);
    const realTarget = target.resolveReal(this.fs);
    if (
      !directory.contains(target) ||
      realDirectory === undefined ||
      realTarget === undefined ||
      !realDirectory.contains(realTarget)
    ) {
      throw new ZitadelConfigError(
        `${path} points outside .zitadel/; files are only written and removed inside it`,
      );
    }
    return target;
  }

  /**
   * Place a file the store removes, inside `.zitadel/` and not a directory.
   *
   * @param path - The project-relative path.
   * @returns The path to remove.
   * @throws {@link ZitadelConfigError} When the path, or the real target behind a
   *   symlink on the way, leaves `.zitadel/`, or it is a directory.
   */
  private removable(path: string): string {
    const target = this.place(path).toString();
    if (this.fs.existsSync(target) && this.fs.lstatSync(target).isDirectory()) {
      throw new ZitadelConfigError(
        `${path} cannot be removed (EISDIR): it is a directory where a file is expected`,
      );
    }
    return target;
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
   * @throws {@link ZitadelConfigError} When the path, or the real target behind a
   *   symlink on the way, leaves the project.
   */
  private locate(file: ConfigFile, ref: string): Path {
    const target = this.root.resolve(file.path).parent.resolve(ref);
    const realRoot = this.root.resolveReal(this.fs);
    const realTarget = target.resolveReal(this.fs);
    if (
      !this.root.contains(target) ||
      realRoot === undefined ||
      realTarget === undefined ||
      !realRoot.contains(realTarget)
    ) {
      throw new ZitadelConfigError(
        `$file ${JSON.stringify(ref)} points outside the project; keep referenced files inside the project, next to the file that references them`,
      );
    }
    return target;
  }

  /**
   * Read and parse one file, where data enters the library.
   *
   * @param path - The project-relative path.
   * @returns The file; an {@link UnparsedFile} with the reason when it is not
   *   valid JSON, not a JSON object, or a directory.
   * @throws {@link ZitadelConfigFileUnreadableError} When the operating system
   *   refuses to let it be read, naming the error code.
   * @throws {@link ZitadelConfigPathUnreadableError} When it cannot be read for
   *   another reason, naming the error code when there is one.
   */
  private async readFileAt(path: string): Promise<StoredFile> {
    try {
      const contents = await this.fs.promises.readFile(this.root.resolve(path).toString(), "utf8");
      const text = contents.toString();
      try {
        const body: unknown = JSON.parse(text);
        if (!isJsonValue(body) || !isJsonObject(body)) {
          return UnparsedFile.notAnObject(path);
        }
        return { path, body };
      } catch (error) {
        if (error instanceof SyntaxError) {
          return UnparsedFile.invalidJson(path, text);
        }
        throw error;
      }
    } catch (error) {
      // A directory named like a file cannot be parsed, but it hides nothing
      // else: it is reported as the broken entry it is.
      if (isErrno(error, "EISDIR")) {
        return UnparsedFile.directory(path);
      }
      if (isErrno(error, "EACCES")) {
        throw new ZitadelConfigFileUnreadableError(path, "EACCES", error);
      }
      if (isErrno(error, "EPERM")) {
        throw new ZitadelConfigFileUnreadableError(path, "EPERM", error);
      }
      throw new ZitadelConfigPathUnreadableError(path, Store.errnoOf(error), error);
    }
  }

  /**
   * The operating system's error code a failed call carries, read here where
   * the injected file system's failures enter the library.
   *
   * @param error - What the call failed with.
   * @returns The code, or `undefined` when the failure carries none.
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

  /**
   * The file that stands where a directory is needed for a file to be written.
   *
   * @remarks
   * Nothing can exist beneath a regular file, so the nearest ancestor that
   * exists is the one in the way, when it is not a directory.
   *
   * @param target - Where the file is written.
   * @returns The project-relative path of the file in the way, or `undefined`
   *   when the nearest existing ancestor is a directory.
   */
  private blockerOf(target: Path): string | undefined {
    const nearest = [target.parent, ...target.parent.ancestors].find((directory) => {
      return this.fs.existsSync(directory.toString());
    });
    if (nearest === undefined || this.fs.statSync(nearest.toString()).isDirectory()) {
      return undefined;
    }
    return nearest.relativeTo(this.root);
  }

  /**
   * Refuse a write that a file in the way would stop, before anything is
   * written.
   *
   * @param path - The project-relative path being written.
   * @param target - Where it is written.
   * @throws {@link ZitadelConfigError} When a directory it needs is a file.
   */
  private assertClear(path: string, target: Path): void {
    const blocker = this.blockerOf(target);
    if (blocker !== undefined) {
      throw new ZitadelConfigError(
        `${path} cannot be written (ENOTDIR): ${blocker} is a file where a directory is needed`,
      );
    }
  }
}
