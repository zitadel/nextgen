import type { Fact, SetupServices } from "@/cli/commands/setup/shared";
import {
  describeWrittenFile,
  relativeDisplayPath as relativeDisplay,
} from "@/cli/commands/setup/shared";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { errorMessage, isErrno } from "@/lib/errors";
import { reportWarning } from "@/lib/warnings";

import { escapeControlCharacters } from "@/lib/terminal-text";
import { WizardStep } from "@/lib/wizard";

/**
 * The env files the patch merges a project's id and secrets into: `.env.local`
 * for the app, and `.env.development.local`, which the recovery commands pin
 * with `--env-file` and which therefore decides which project they target.
 */
const CREDENTIAL_ENV_FILES = [".env.local", ".env.development.local"] as const;

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"patcher" | "patchContext" | "framework" | "project">;

/**
 * What the step is given by the command.
 */
type Deps = Pick<SetupServices, "cwd" | "dryRun" | "force" | "ui">;

/**
 * Patches the app's files to use the project.
 *
 * @remarks
 * Setup is not atomic: the patch writes `zitadel.json`, which the
 * already-initialized guard skips on, and `.zitadel/secret`. A step after it that
 * fails takes both away, and puts `.env.local`, where the patch merged the
 * project's credentials, back to what it held before, so a rerun starts a fresh
 * setup instead of being skipped forever.
 */
export class PatchApp extends WizardStep<
  "patch",
  Fact<"patched" | "envFilesBefore" | "patching">,
  Needs
> {
  readonly key = "patch";

  /**
   * @param deps - What the command gives the step.
   */
  private readonly deps: Deps;

  constructor(deps: Deps) {
    super();
    this.deps = deps;
  }

  /**
   * Patch the files, or say what a dry run would.
   *
   * @remarks
   * The credential files are read as they are before the patch merges this project's id and secret
   * into them, so a failure below can put them back. Only a missing file counts as absent: any
   * other read error is rethrown, because reading it as "absent" would make the rollback delete a
   * pre-existing file it should have restored. What the patch writes depends on the files the
   * scaffold creates.
   *
   * The dry run before this step already ruled out conflicts, so a failure of the patch is an I/O
   * failure partway through. It removes the setup markers and puts `.env.local` back, so a rerun
   * starts over.
   *
   * @param needs - The patcher, the app and the project.
   * @returns What was patched, what the credential files held before, and the
   *   spinner the rest of the files are reported under.
   */
  async run(needs: Needs): Promise<Fact<"patched" | "envFilesBefore" | "patching">> {
    const { framework, patchContext, patcher, project } = needs;
    const envFilesBefore: ReadonlyMap<string, Buffer | undefined> = new Map(
      await Promise.all(
        CREDENTIAL_ENV_FILES.map(async (file): Promise<readonly [string, Buffer | undefined]> => {
          try {
            return [file, await readFile(join(this.deps.cwd, file))];
          } catch (error) {
            if (!isErrno(error, "ENOENT")) {
              throw error;
            }
            return [file, undefined];
          }
        }),
      ),
    );
    if (framework === undefined) {
      this.deps.ui
        .begin("Patching project files (dry run)")
        .done("Would patch the new project (dry run): its files come from the scaffold");
      return {
        patched: {
          dryRun: this.deps.dryRun,
          files: [],
          filesWritten: [],
          filesSkipped: [],
          depsAdded: [],
        },
        envFilesBefore,
        patching: undefined,
      };
    }
    const patching = this.deps.ui.begin(
      `Patching project files${this.deps.dryRun ? " (dry run)" : ""}`,
    );
    const patched = await patcher
      .patch(patchContext(framework, project), {
        cwd: this.deps.cwd,
        dryRun: this.deps.dryRun,
        force: this.deps.force,
      })
      .catch(async (error: unknown) => {
        await this.rollBack(envFilesBefore);
        patching.fail();
        throw error;
      });
    for (const file of patched.filesWritten) {
      const sentence = describeWrittenFile(relativeDisplay(this.deps.cwd, file), this.deps.dryRun);
      if (sentence) {
        patching.detail(sentence);
      }
    }
    for (const file of patched.filesSkipped) {
      patching.detail(
        `Left ${escapeControlCharacters(relativeDisplay(this.deps.cwd, file))} unchanged (already matches target)`,
      );
    }
    return {
      patched,
      envFilesBefore,
      patching,
    };
  }

  /**
   * Remove the setup markers and put the credential files back.
   *
   * @param out - What the patch did, and what the credential files held before.
   * @returns Once they are removed.
   */
  override async undo(out: Fact<"patched" | "envFilesBefore" | "patching">): Promise<void> {
    await this.rollBack(out.envFilesBefore);
  }

  /**
   * Remove the setup markers and put the credential files back to what they held.
   *
   * @remarks
   * Removes `zitadel.json` (the marker the already-initialized guard skips on) and
   * `.zitadel/secret`, so a setup that failed after writing them can be rerun. Puts the credential
   * env files back to what the step read before the patch, and removes one setup created: the
   * patch merged the failed setup's project id and secrets into them, and a merge only adds the
   * keys a file is missing, `--force` or not, so left in place they would survive the rerun and
   * the app would talk to an abandoned project with no schema or login flow. `.env.example` needs
   * nothing: it gets the same empty values on every run.
   *
   * A marker that cannot be removed or a file that cannot be restored is reported as a warning
   * rather than thrown, and the rest of the rollback still runs: this runs while setup is already
   * failing, and the real error carries the remedy the developer needs.
   *
   * @param envFilesBefore - What each credential env file held before the patch.
   * @returns Once they are removed.
   */
  private async rollBack(envFilesBefore: ReadonlyMap<string, Buffer | undefined>): Promise<void> {
    if (!this.deps.dryRun) {
      for (const marker of ["zitadel.json", ".zitadel/secret"]) {
        try {
          await rm(join(this.deps.cwd, marker), { force: true });
        } catch (error) {
          reportWarning(
            `Could not remove ${marker} after the failed setup (${errorMessage(error)}); a rerun may refuse to start until it is removed.`,
          );
        }
      }
      for (const [file, content] of envFilesBefore) {
        try {
          if (content === undefined) {
            await rm(join(this.deps.cwd, file), { force: true });
          } else {
            await writeFile(join(this.deps.cwd, file), content);
          }
        } catch (error) {
          reportWarning(
            `Could not restore ${file} after the failed setup (${errorMessage(error)}); it may still name the abandoned project.`,
          );
        }
      }
    }
  }
}
