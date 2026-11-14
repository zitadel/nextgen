import {
  describeWrittenFile,
  type Fact,
  relativeDisplayPath as relativeDisplay,
  type SetupServices,
  signInOf,
} from "@/cli/commands/setup/shared";
import { toZitadelError } from "@/lib/errors";
import { reportWarning } from "@/lib/warnings";
import { WizardStep } from "@/lib/wizard";

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"answers" | "newApp" | "framework" | "patching" | "patched" | "scaffolded">;

/**
 * What the step is given by the command.
 */
type Deps = Pick<SetupServices, "cwd" | "dryRun">;

/**
 * Keeps the new app, now that its default resources are in place, and finishes
 * reporting the files.
 *
 * @remarks
 * Setup itself is done after it: what the scaffold replaced is all that is left
 * to delete, and nothing before this takes back what a later step does.
 */
export class KeepChanges extends WizardStep<"keep", Fact<"allFilesWritten" | "signIn">, Needs> {
  /**
   * The step's name, which a wizard refuses to hold twice.
   */
  readonly key = "keep";

  /**
   * What the command gives the step.
   */
  private readonly deps: Deps;

  /**
   * @param deps - What the command gives the step.
   */
  constructor(deps: Deps) {
    super();
    this.deps = deps;
  }

  /**
   * Keep the new app, and report every file written.
   *
   * @remarks
   * Setup itself is done; only what the scaffold replaced is left behind.
   *
   * The minimum length comes from the policy setup published: a file `--force` kept decides it as
   * much as the answers do.
   *
   * @param needs - What the patch and the configuration did.
   * @returns Every file written, and what sign-in is configured to do.
   */
  async run(needs: Needs): Promise<Fact<"allFilesWritten" | "signIn">> {
    const { answers, framework, newApp, patched, patching, scaffolded } = needs;
    try {
      await newApp?.keep();
    } catch (error) {
      reportWarning(
        `Could not delete what the new app replaced, kept beside ${this.deps.cwd}: ${toZitadelError(error).message}`,
      );
    }
    for (const file of scaffolded.filesWritten) {
      const sentence = describeWrittenFile(relativeDisplay(this.deps.cwd, file), this.deps.dryRun);
      if (sentence) {
        patching?.detail(sentence);
      }
    }
    const allFilesWritten = [...patched.filesWritten, ...scaffolded.filesWritten];
    if (framework !== undefined) {
      patching?.done(
        `${this.deps.dryRun ? "Would patch" : "Patched"} ${allFilesWritten.length} ${new Intl.PluralRules("en").select(allFilesWritten.length) === "one" ? "file" : "files"}${patched.filesSkipped.length > 0 ? ` (${patched.filesSkipped.length} unchanged)` : ""}${this.deps.dryRun ? " (dry run)" : ""}`,
      );
    }
    return {
      allFilesWritten,
      signIn: {
        ...signInOf(answers),
        password_min_length: scaffolded.passwordMinLength,
      },
    };
  }
}
