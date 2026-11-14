import { toZitadelError } from "@/lib/errors";
import { writeScaffoldManifest } from "@/lib/scaffold-manifest";
import { reportWarning } from "@/lib/warnings";
import { WizardStep } from "@/lib/wizard";

import type { Fact, SetupServices } from "@/cli/commands/setup/shared";

/**
 * What the step reads from what is known.
 */
type Needs = Fact<
  "orca" | "framework" | "rendererId" | "patched" | "scaffoldedFramework" | "answers" | "posture"
>;

/**
 * What the step is given by the command.
 */
type Deps = Pick<SetupServices, "cwd" | "dryRun">;

/**
 * Records what was actually scaffolded, so `doctor` can later verify the app
 * files without guessing from current templates (missing vs edited vs
 * user-adopted) and `doctor --fix` can restore exactly the missing ones.
 *
 * @remarks
 * Best-effort: a failure here only degrades doctor to its template-derived
 * fallback, it never breaks setup.
 */
export class WriteManifest extends WizardStep<"manifest", object, Needs> {
  readonly key = "manifest";

  /**
   * @param deps - What the command gives the step.
   */
  private readonly deps: Deps;

  constructor(deps: Deps) {
    super();
    this.deps = deps;
  }

  /**
   * Write the manifest.
   *
   * @param needs - What the patch did.
   * @returns Nothing is added.
   */
  async run(needs: Needs): Promise<object> {
    const { answers, framework, orca, patched, posture, rendererId, scaffoldedFramework } = needs;
    if (framework !== undefined && !this.deps.dryRun) {
      try {
        await writeScaffoldManifest({
          cwd: this.deps.cwd,
          actions: orca.patcherFor(framework.id).artifacts({
            framework,
            rendererId,
          }),
          written: [...patched.filesWritten, ...patched.filesSkipped],
          scaffoldedFramework,
          devPort: answers.devPort,
          posture,
        });
      } catch (error) {
        reportWarning(
          `Could not record what setup scaffolded, so doctor will check this app against the current templates: ${toZitadelError(error).message}`,
        );
      }
    }
    return {};
  }
}
