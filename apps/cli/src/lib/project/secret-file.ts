import { chmod, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { warnings } from "@/lib/ui";

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
   * Whether the file is owner read/write only. Where the filesystem keeps no
   * modes (Windows, FAT), nothing more can be done to it, so it is secure.
   *
   * @param path - The file.
   * @returns `true` when it is as private as its filesystem lets it be.
   * @throws Any `stat` error, such as the file being missing.
   */
  static async isSecure(path: string): Promise<boolean> {
    const mode = (await stat(path)).mode & 0o777;
    return mode === SECRET_MODE || !(await SecretFile.keepsModes(dirname(path)));
  }

  /**
   * Makes the file owner read/write only, as far as its filesystem allows.
   *
   * @param path - The file.
   */
  static secure(path: string): Promise<void> {
    return SecretFile.enforceMode(path, SECRET_MODE);
  }

  /**
   * Whether a file keeps the mode it is given, found by trying one in the
   * directory the secret lives in, so it needs no list of the platforms and
   * filesystems that do not and answers for the filesystem the secret is on.
   * The probe file is removed again. A filesystem that refuses `chmod` keeps
   * no modes; where the probe cannot be made at all, modes are taken to be kept.
   *
   * @param dir - The directory the secret is in.
   * @returns `true` when the mode a file is given is the mode it reads back.
   */
  private static async keepsModes(dir: string): Promise<boolean> {
    const probe = join(dir, `.modes-probe-${process.pid}`);
    try {
      await writeFile(probe, "", { mode: SECRET_MODE });
      const accepted = await chmod(probe, 0o640).then(
        () => {
          return true;
        },
        () => {
          return false;
        },
      );
      return accepted && ((await stat(probe)).mode & 0o777) === 0o640;
    } catch {
      return true;
    } finally {
      await rm(probe, { force: true }).catch(() => {
        return undefined;
      });
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
