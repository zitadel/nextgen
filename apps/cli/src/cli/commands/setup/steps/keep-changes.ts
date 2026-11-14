import {
  describeWrittenFile,
  relativeDisplayPath as relativeDisplay,
  type SignIn,
  signInOf,
} from "@/cli/commands/setup/shared";
import { toZitadelError } from "@/lib/errors";
import { reportWarning } from "@/lib/warnings";
import { WizardStep } from "@/lib/wizard";

import type { Fact, SetupServices } from "@/cli/commands/setup/shared";

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"answers" | "newApp" | "framework" | "patching" | "patched" | "scaffolded">;

/**
 * Keeps the new app, now that its default resources are in place, and finishes
 * reporting the files.
 *
 * @remarks
 * Setup itself is done after it: what the scaffold replaced is all that is left
 * to delete, and nothing before this takes back what a later step does.
 */
export class KeepChanges extends WizardStep<
  "keep",
  Fact<"allFilesWritten" | "signIn">,
  Needs,
  SetupServices
> {
  readonly key = "keep";

  /**
   * Keep the new app, and report every file written.
   *
   *
   * @remarks
   * Setup itself is done; only what the scaffold replaced is left behind.
   *
   * @param needs - What the patch and the configuration did.
   * @param services - What the command provides.
   * @returns Every file written, and what sign-in is configured to do.
   */
  async run(needs: Needs, services: SetupServices): Promise<Fact<"allFilesWritten" | "signIn">> {
    const { answers, framework, newApp, patched, patching, scaffolded } = needs;
    try {
      await newApp?.keep();
    } catch (error) {
      reportWarning(
        `Could not delete what the new app replaced, kept beside ${services.cwd}: ${toZitadelError(error).message}`,
      );
    }
    for (const file of scaffolded.filesWritten) {
      const sentence = describeWrittenFile(relativeDisplay(services.cwd, file), services.dryRun);
      if (sentence) {
        patching?.detail(sentence);
      }
    }
    const allFilesWritten = [...patched.filesWritten, ...scaffolded.filesWritten];
    if (framework !== undefined) {
      patching?.done(
        `${services.dryRun ? "Would patch" : "Patched"} ${allFilesWritten.length} ${new Intl.PluralRules("en").select(allFilesWritten.length) === "one" ? "file" : "files"}${patched.filesSkipped.length > 0 ? ` (${patched.filesSkipped.length} unchanged)` : ""}${services.dryRun ? " (dry run)" : ""}`,
      );
    }
    // The minimum length comes from the policy setup published: a file
    // `--force` kept decides it as much as the answers do.
    const signIn: SignIn = {
      ...signInOf(answers),
      password_min_length: scaffolded.passwordMinLength,
    };
    services.filesPatched(allFilesWritten.length, scaffolded.passwordMinLength);
    return {
      allFilesWritten,
      signIn,
    };
  }
}
