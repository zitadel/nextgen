import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import fse from "fs-extra";

import { entryExists, readDirIfExists } from "@/lib/fs";

/**
 * Where a scaffold into a project that already holds files runs. The scaffolders
 * need an empty directory, so one runs in an empty directory beside the project
 * and its result is moved in. Nothing the project already holds is moved unless
 * the scaffold made an entry of the same name, so files a running server holds
 * open stay where they are. What the scaffold replaces is backed up, so an undo
 * can put it back.
 */
export class ScaffoldWorkspace {
  /**
   * Makes the workspace beside the project.
   *
   * @param cwd - The project directory.
   * @param names - What the project holds. With nothing, the scaffold runs in the project itself.
   * @returns The workspace, or `undefined` when the project is empty.
   */
  static async open(
    cwd: string,
    names: ReadonlyArray<string>,
  ): Promise<ScaffoldWorkspace | undefined> {
    if (names.length === 0) {
      return undefined;
    }
    const dir = join(
      dirname(cwd),
      `.${basename(cwd).slice(0, 100)}.scaffold-workspace-${String(process.pid)}-${String(Date.now())}`,
    );
    const work = join(dir, "work", basename(cwd));
    await mkdir(work, { recursive: true, mode: 0o700 });
    return new ScaffoldWorkspace(dir, work);
  }

  /** The empty directory the scaffold runs in, named as the project is. */
  readonly work: string;

  private readonly dir: string;

  /**
   * @param dir - The folder that holds the work directory and the backup.
   * @param work - The empty directory the scaffold runs in.
   */
  private constructor(dir: string, work: string) {
    this.dir = dir;
    this.work = work;
  }

  /**
   * Moves what the scaffold created into the project. What the project already
   * holds under the same name is backed up first. For `.gitignore` the backed-up
   * rules are merged in, so ignores the existing setup relied on, notably
   * `.zitadel/local/`, which keeps the local admin credential out of git, are
   * not dropped. A `.git` the project holds is never replaced. Any other
   * collision keeps the scaffold's version, which is what `--force` is for.
   *
   * @param cwd - The project directory.
   */
  async moveInto(cwd: string): Promise<void> {
    await mkdir(this.backup, { recursive: true, mode: 0o700 });
    for (const name of await readdir(this.work)) {
      const dest = join(cwd, name);
      const replaces = await entryExists(dest);
      if (replaces && name === ".git") {
        continue;
      }
      if (replaces) {
        await fse.move(dest, join(this.backup, name));
      }
      await fse.move(join(this.work, name), dest);
      if (replaces && name === ".gitignore") {
        await this.mergeGitignore(dest);
      }
    }
  }

  /**
   * The names the scaffold replaced in the project.
   *
   * @returns The backed-up entry names.
   */
  replaced(): Promise<string[]> {
    return readDirIfExists(this.backup);
  }

  /**
   * Puts back what the scaffold replaced.
   *
   * @param cwd - The project directory.
   */
  async restoreInto(cwd: string): Promise<void> {
    for (const name of await this.replaced()) {
      await rename(join(this.backup, name), join(cwd, name));
    }
  }

  /**
   * Lets go of the workspace and the backup.
   *
   * @returns Once both are removed.
   */
  async drop(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true });
  }

  /**
   * Where what the scaffold replaces is kept.
   *
   * @returns The backup directory, which exists once something is moved in.
   */
  private get backup(): string {
    return join(this.dir, "backup");
  }

  /**
   * Appends any lines from the backed-up `.gitignore` that the scaffold's own one lacks.
   *
   * @param dest - The scaffold's `.gitignore` in the project, which is written.
   */
  private async mergeGitignore(dest: string): Promise<void> {
    const [from, into] = await Promise.all([
      readFile(join(this.backup, ".gitignore"), "utf8"),
      readFile(dest, "utf8"),
    ]);
    const present = new Set(
      into.split("\n").map((line) => {
        return line.trim();
      }),
    );
    const missing = from.split("\n").filter((line) => {
      return line.trim() && !present.has(line.trim());
    });
    if (missing.length === 0) {
      return;
    }
    await writeFile(dest, `${into}${into.endsWith("\n") ? "" : "\n"}${missing.join("\n")}\n`);
  }
}
