import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { isErrno } from "@/lib/errors";
import { readIfExists } from "@/lib/fs";
import { enforceMode } from "@/lib/fs-safe";
import type { Change, DirChange, FileChange } from "./operation";
import type { Outcome } from "./report";

/**
 * How a run is executed.
 */
export type WorkspaceOptions = Readonly<{
  /** The directory every path in the plan is resolved against. */
  cwd: string;
  /** Report what would change without changing anything. */
  dryRun: boolean;
  /** Replace files the plan would otherwise refuse to overwrite. */
  force: boolean;
}>;

/**
 * What is at a path on disk.
 */
export type Entry = Readonly<{
  isDirectory: boolean;
  isFile: boolean;
  /** The permission bits, without the file-type bits. */
  mode: number;
}>;

/**
 * A path that exists, and what is there.
 */
export type Located = Readonly<{
  path: string;
  entry: Entry;
}>;

/**
 * The directory a plan is applied in, and how it is applied: the one place the
 * file-writer reads and writes the disk.
 *
 * With `dryRun` nothing is written, but every {@link Outcome} still says what
 * would have happened. Existing files are only replaced when `force` is set. A
 * workspace never changes once it is made.
 */
export class Workspace {
  readonly cwd: string;
  readonly dryRun: boolean;
  readonly force: boolean;

  /**
   * @param options - Where and how plans are applied.
   */
  constructor(options: WorkspaceOptions) {
    this.cwd = options.cwd;
    this.dryRun = options.dryRun;
    this.force = options.force;

    Object.freeze(this);
  }

  private static directoryAction(isExisting: boolean, isDrifted: boolean): Outcome["action"] {
    if (!isExisting) {
      return "create";
    }
    if (isDrifted) {
      return "update";
    }

    return "skip";
  }

  private static fileAction(isUnchanged: boolean, before: string | undefined): Outcome["action"] {
    if (isUnchanged) {
      return "skip";
    }
    if (before === undefined) {
      return "create";
    }

    return "update";
  }

  /**
   * @param path - A path in the plan, relative to the workspace.
   * @returns The path on disk.
   */
  resolve(path: string): string {
    return join(this.cwd, path);
  }

  /**
   * @param path - A path on disk.
   * @returns What the file holds, or `undefined` when there is none.
   */
  async read(path: string): Promise<string | undefined> {
    return await readIfExists(path);
  }

  /**
   * @param path - A path on disk.
   * @returns What is there, or `undefined` when nothing is.
   */
  async inspect(path: string): Promise<Entry | undefined> {
    try {
      const stats = await stat(path);

      return {
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
        mode: stats.mode & 0o777,
      };
    } catch (error) {
      if (isErrno(error, "ENOENT")) {
        return undefined;
      }

      throw error;
    }
  }

  /**
   * Looks at the candidates in order and stops at the first that exists, so an
   * unreadable fallback cannot fail the edit of a file that was found.
   *
   * @param paths - Paths on disk, in order of preference.
   * @returns The first that exists, and what is there, or `undefined` when none does.
   */
  async locate(paths: ReadonlyArray<string>): Promise<Located | undefined> {
    const [path, ...rest] = paths;

    if (path === undefined) {
      return undefined;
    }

    const entry = await this.inspect(path);

    if (entry === undefined) {
      return await this.locate(rest);
    }

    return {
      path,
      entry,
    };
  }

  /**
   * Makes `change` on disk, or only reports it on a dry run.
   *
   * @param change - What an op asked of the disk.
   * @returns What happened to the artifact the change is about.
   */
  async commit(change: Change): Promise<Outcome> {
    if (change.kind === "dir") {
      return await this.commitDirectory(change);
    }

    return await this.commitFile(change);
  }

  private async commitDirectory(change: DirChange): Promise<Outcome> {
    const { path, mode, isExisting, isDrifted } = change;
    const action = Workspace.directoryAction(isExisting, isDrifted);

    if (!this.dryRun) {
      await mkdir(path, {
        recursive: true,
        mode,
      });
    }
    if (!this.dryRun && mode) {
      await enforceMode(path, mode);
    }

    return {
      path,
      kind: "dir",
      action,
    };
  }

  private async commitFile(change: FileChange): Promise<Outcome> {
    const { path, before, next, mode, reassertMode = false, dependency } = change;
    const isUnchanged = next === before;
    const isHealing = isUnchanged && reassertMode && mode !== undefined && before !== undefined;
    const action = Workspace.fileAction(isUnchanged, before);
    const reported = isUnchanged ? undefined : dependency;

    if (isHealing && !this.dryRun) {
      await enforceMode(path, mode);
    }
    if (!isUnchanged && !this.dryRun) {
      await this.store(change);
    }

    return {
      path,
      kind: "file",
      action,
      dependency: reported,
    };
  }

  /**
   * Writes the file, and the directories above it that do not exist yet.
   */
  private async store(change: FileChange): Promise<void> {
    const { path, next, mode, atomic = false } = change;
    const target = atomic ? `${path}.tmp-${process.pid}-${Date.now()}` : path;

    await mkdir(dirname(path), {
      recursive: true,
    });
    await writeFile(target, next, {
      mode,
    });
    if (mode !== undefined) {
      await enforceMode(target, mode);
    }
    if (atomic) {
      await rename(target, path);
    }
  }
}
