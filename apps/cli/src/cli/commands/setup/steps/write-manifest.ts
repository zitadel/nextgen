import type { Fact, SetupServices } from "@/cli/commands/setup/shared";
import { ZitadelLibError } from "@/lib/errors";
import { warnings } from "@/lib/ui";
import { WizardStep } from "@/lib/wizard";
import { Orca } from "@/lib/orca";

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
  /**
   * The step's name, which a wizard refuses to hold twice.
   */
  readonly key = "manifest";

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
   * Write the manifest.
   *
   * @param needs - What the patch did.
   * @returns Nothing is added.
   */
  async run(needs: Needs): Promise<object> {
    const { answers, framework, orca, patched, posture, rendererId, scaffoldedFramework } = needs;
    if (framework !== undefined && !this.deps.dryRun) {
      try {
        await Orca.writeManifest({
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
        if (error instanceof ZitadelLibError) {
          warnings.report(
            `Could not record what setup scaffolded, so doctor will check this app against the current templates: ${error.message}`,
          );
          return {};
        }
        throw error;
      }
    }
    return {};
  }
}
