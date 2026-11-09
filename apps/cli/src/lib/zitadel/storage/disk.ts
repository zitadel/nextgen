import { readFileSync } from "node:fs";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";

import { stringify } from "safe-stable-stringify";

import { ConfigError, FileExistsError } from "@/lib/zitadel/errors";
import { CONFIG_DIRECTORIES, type ConfigFile, type ConfigKind, type JsonObject } from "@/lib/zitadel/types";
import { Path } from "@/lib/zitadel/storage/path";
import { findFileReferences, inlineFileReferences, outsideProject } from "@/lib/zitadel/storage/references";
import type { ConfigStore, MissingReference, WriteMode } from "@/lib/zitadel/storage/types";
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
   * Every `*.json` file of one kind, parsed.
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
        const body: unknown = await readFile(this.root.resolve(path).toString(), "utf8")
          .then((text): unknown => {
            return JSON.parse(text);
          })
          .catch((error: unknown) => {
            // Only the position is kept: V8 quotes the source it choked on,
            // and a connection file is where a pasted secret would be.
            const position = error instanceof Error ? /position (\d+)/.exec(error.message)?.[1] : undefined;
            throw new ConfigError(`${path} is not valid JSON`, {
              hint: "Fix the file, then run the command again.",
              details: {
                file: path,
                parse_error: position === undefined ? "invalid JSON" : `invalid JSON at position ${position}`,
              },
            });
          });
        if (!isJsonObject(body)) {
          throw new ConfigError(`${path} does not contain a JSON object`, { details: { file: path } });
        }
        return { path, body };
      }),
    );
  }

  /**
   * Whether a file is there, without reading it.
   *
   * @param path - The project-relative path.
   * @returns Whether it exists.
   */
  async exists(path: string): Promise<boolean> {
    return access(this.root.resolve(path).toString()).then(
      () => {
        return true;
      },
      () => {
        return false;
      },
    );
  }

  /**
   * Write one file's body as JSON with its keys sorted, creating the
   * directories it needs.
   *
   * @param file - The file to write.
   * @param mode - Whether an existing file may be replaced.
   * @throws {@link FileExistsError} When the file is already there, under
   *   `create`.
   */
  async write(file: ConfigFile, mode: WriteMode): Promise<void> {
    return this.writeText(file.path, `${stringify(file.body, null, 2) ?? "null"}\n`, mode);
  }

  /**
   * Write a file's text as given, creating the directories it needs.
   *
   * @param path - The project-relative path.
   * @param text - What it holds.
   * @param mode - Whether an existing file may be replaced.
   * @throws {@link FileExistsError} When the file is already there, under
   *   `create`.
   */
  async writeText(path: string, text: string, mode: WriteMode): Promise<void> {
    const target = this.root.resolve(path);
    await mkdir(target.parent.toString(), { recursive: true });
    await writeFile(target.toString(), text, { flag: mode === "create" ? "wx" : "w" }).catch(
      (error: unknown) => {
        if (errnoOf(error) === "EEXIST") {
          throw new FileExistsError(path);
        }
        throw error;
      },
    );
  }

  /**
   * A body with every `$file` reference replaced by the text of the file it
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
          const code = errnoOf(error);
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
   * The project-relative paths a file's `$file` references point at.
   *
   * @param file - The file.
   * @returns The paths, spelled with `/`.
   * @throws {@link ConfigError} When a reference leads outside the project.
   */
  referencedPaths(file: ConfigFile): readonly string[] {
    return findFileReferences(file.body).map(({ ref }) => {
      return this.locate(file, ref).relativeTo(this.root);
    });
  }

  /**
   * Where a reference points, resolved against the directory of the file
   * holding it.
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
    const realRoot = this.root.real();
    const realTarget = target.real();
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
}

/**
 * The error code of a failed file operation.
 *
 * @param error - What the operation threw.
 * @returns Its code, such as `ENOENT`, or `undefined` when it has none.
 */
function errnoOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}
