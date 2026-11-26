import { createHash } from "node:crypto";
import { isAbsolute, join, relative, sep } from "node:path";

import { FsNotFoundError, readFile } from "@/lib/fs";
import { isObject } from "@/lib/json";
import { readState, updateScaffold } from "@/lib/sync/state";
import type { ScaffoldManifest, ScaffoldPosture } from "@/lib/sync/types";

import type { EjectActions } from "./patchers/types";

/**
 * The scaffold manifest in `.zitadel/state.json`: which managed app files setup
 * wrote, and the hash of each as it wrote it.
 */
export class ScaffoldManifestFile {
  /** The project's directory. */
  private readonly cwd: string;

  /**
   * @param cwd - The project's directory.
   */
  constructor(cwd: string) {
    this.cwd = cwd;
  }
  /**
   * Content hash of one scaffolded file as recorded in the scaffold manifest.
   * Deliberately hashes the raw text (not a parsed structure): the manifest
   * answers "are these still the bytes setup wrote?", nothing more. The sync
   * loop's hashers work on JSON objects and serve a different contract.
   */
  static hash(contents: string): string {
    return createHash("sha256").update(contents).digest("hex");
  }

  /**
   * Read the scaffold manifest from `.zitadel/state.json`, or `undefined` when
   * the file, the section, its `files` record, or any file entry is missing or
   * malformed (each entry needs a string `hash` and a known `class`).
   * `undefined` sends the doctor managed-files check into its template-derived
   * fallback mode, so a corrupt or future-shaped manifest degrades rather than
   * breaks.
   */
  async read(): Promise<ScaffoldManifest | undefined> {
    try {
      const state = await readState(this.cwd);
      const scaffold = state.scaffold;
      // isObject rejects arrays too — `typeof [] === "object"`, and an array
      // `files` would otherwise enter manifest mode as "0 tracked".
      if (!isObject(scaffold)) {
        return undefined;
      }
      if (!isObject(scaffold.files)) {
        return undefined;
      }
      for (const entry of Object.values(scaffold.files)) {
        if (!isObject(entry)) {
          return undefined;
        }
        if (typeof entry.hash !== "string") {
          return undefined;
        }
        if (entry.class !== "infrastructure" && entry.class !== "presentation") {
          return undefined;
        }
      }
      // A posture value this CLI does not know is a future-shaped manifest —
      // degrade like any other malformed section rather than restoring a
      // posture the templates cannot render.
      if (
        scaffold.posture !== undefined &&
        scaffold.posture !== "page" &&
        scaffold.posture !== "widget"
      ) {
        return undefined;
      }
      return scaffold as unknown as ScaffoldManifest;
    } catch {
      return undefined;
    }
  }

  /**
   * Record which managed app files `zitadel setup` actually wrote (or found
   * already matching), keyed by project-root-relative posix path with the
   * content hash and ownership class. Only marked files that the scaffold run
   * touched are recorded — a conditional file whose op never ran (e.g. the
   * framework home page on a pre-existing app) is simply absent, which is what
   * lets `doctor` later distinguish "CLI wrote this and it vanished" from "the
   * CLI never owned this".
   */
  async write(options: {
    actions: EjectActions;
    /** Paths the scaffold reported written or skipped-as-identical. */
    written: ReadonlyArray<string>;
    scaffoldedFramework?: boolean;
    devPort?: number;
    posture?: ScaffoldPosture;
  }): Promise<void> {
    const { cwd } = this;
    const { actions, written, scaffoldedFramework, devPort, posture } = options;
    const touched = new Set(
      written.map((path) => {
        return ScaffoldManifestFile.relativePosix(cwd, path);
      }),
    );
    const marked = actions.markedFiles
      .map((path) => {
        return { path, key: ScaffoldManifestFile.relativePosix(cwd, path) };
      })
      .filter(({ key }) => {
        return touched.has(key);
      });
    const read = await Promise.all(
      marked.map(async ({ path, key }) => {
        try {
          const contents = await readFile(join(cwd, key), "utf8");
          return {
            path,
            key,
            contents,
          };
        } catch (error) {
          if (error instanceof FsNotFoundError) {
            return {
              path,
              key,
              contents: undefined,
            };
          }
          throw error;
        }
      }),
    );
    const files: ScaffoldManifest["files"] = Object.fromEntries(
      read.flatMap(({ path, key, contents }) => {
        return contents === undefined
          ? []
          : [
              [
                key,
                {
                  hash: ScaffoldManifestFile.hash(contents),
                  class: actions.fileClasses?.[path] ?? "presentation",
                },
              ],
            ];
      }),
    );
    await updateScaffold(cwd, {
      files,
      ...(scaffoldedFramework ? { scaffolded_framework: true } : {}),
      ...(typeof devPort === "number" ? { dev_port: devPort } : {}),
      ...(posture === undefined ? {} : { posture }),
    });
  }

  /** Normalizes an absolute or relative path to a cwd-relative posix key. */
  private static relativePosix(cwd: string, path: string): string {
    const rel = isAbsolute(path) ? relative(cwd, path) : path;
    return rel.split(sep).join("/");
  }
}
