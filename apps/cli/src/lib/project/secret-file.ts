import { chmod, stat, writeFile } from "node:fs/promises";

import { warnings } from "@/lib/ui/warnings";

/** A file that may carry a credential is owner read/write only. */
const SECRET_MODE = 0o600;

/**
 * A file that may hold a credential. The mode, the chmod-failure policy and
 * the write are decided here once, rather than re-decided, or forgotten, at
 * each place the CLI writes one.
 */
export class SecretFile {
  /** Where it is. */
  readonly path: string;

  /**
   * @param path - The file's path.
   */
  constructor(path: string) {
    this.path = path;
  }

  /**
   * `writeFile`'s `mode` applies only when it creates the file and is masked by
   * the umask, so this re-asserts the intended mode after a write. A filesystem
   * that cannot chmod (FAT/exFAT, some bind mounts) must not fail the write:
   * the content is already on disk and the next run would read it back without
   * re-prompting, so a throw would be one confusing failure followed by silent
   * success with the same file. It warns once that the file could not be locked
   * down, and proceeds. This is the only place the CLI calls `chmod` after a
   * write: a bare `chmod(...).catch(() => undefined)` hides the failure from
   * the user and the JSON envelope, and a lint rule (`no-swallowed-chmod`)
   * rejects it.
   *
   * @param path - The file.
   * @param mode - The mode it must have.
   */
  static async enforceMode(path: string, mode: number): Promise<void> {
    try {
      await chmod(path, mode);
    } catch (error) {
      warnings.report(
        `Wrote ${path} but could not set it to ${mode.toString(8).padStart(4, "0")} (${(error as NodeJS.ErrnoException).code ?? "unknown"}); its permissions may be broader than intended.`,
      );
    }
  }

  /**
   * Whether the platform keeps POSIX permission bits on a file. Windows reports
   * every file as `0666` and ignores `chmod`, so no mode can be read or set
   * there. This is the one place that says so: callers ask {@link isLockedDown}
   * and {@link relock} and never look at the platform.
   *
   * @param platform - The Node.js platform name.
   * @returns `true` when a file's mode can be read and set.
   */
  static keepsModes(platform: NodeJS.Platform = process.platform): boolean {
    return platform !== "win32";
  }

  /**
   * Whether the file is owner read/write only, or sits on a platform with no
   * modes to be wrong.
   *
   * @param path - The file.
   * @param platform - The Node.js platform name.
   * @returns The mode it has when that is not `0600`, or `undefined` when it is locked down.
   * @throws Any `stat` error, such as the file being missing.
   */
  static async looseMode(
    path: string,
    platform: NodeJS.Platform = process.platform,
  ): Promise<number | undefined> {
    const mode = (await stat(path)).mode & 0o777;
    return SecretFile.keepsModes(platform) && mode !== SECRET_MODE ? mode : undefined;
  }

  /**
   * Locks the file down to `0600`, doing nothing where there are no modes.
   *
   * @param path - The file.
   * @param platform - The Node.js platform name.
   */
  static async relock(path: string, platform: NodeJS.Platform = process.platform): Promise<void> {
    if (SecretFile.keepsModes(platform)) {
      await chmod(path, SECRET_MODE);
    }
  }

  /**
   * Writes the file, creating or overwriting it, held at `0600`.
   *
   * @param contents - What it holds.
   */
  async write(contents: string): Promise<void> {
    await writeFile(this.path, contents, { mode: SECRET_MODE });
    await SecretFile.enforceMode(this.path, SECRET_MODE);
  }
}
