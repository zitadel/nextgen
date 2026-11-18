import { WizardStep } from "@/lib/wizard";

import type { Fact, SetupServices } from "@/cli/commands/setup/shared";

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"patcher" | "patchContext" | "framework" | "issuer">;

/**
 * What the step is given by the command.
 */
type Deps = Pick<SetupServices, "cwd" | "dryRun" | "force">;

/**
 * Patches as a dry run first, against a placeholder project: a file setup would
 * refuse to overwrite (`E_CONFLICT`), such as an existing app's own root
 * component, stops setup here, before it creates a project and writes
 * `zitadel.json`.
 *
 * @remarks
 * Without this, the conflict surfaced after both, and every rerun skipped the
 * directory as already set up.
 */
export class CheckPatch extends WizardStep<"patchCheck", object, Needs> {
  /**
   * The step's name, which a wizard refuses to hold twice.
   */
  readonly key = "patchCheck";

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
   * Run the patch without writing anything.
   *
   * @remarks
   * The placeholder is a deterministic stand-in project, so no remote call is made.
   *
   * @param needs - The patcher, the app and the issuer.
   * @returns Nothing is added.
   * @throws {@link ZitadelError} With `E_CONFLICT` for a file it would refuse.
   */
  async run(needs: Needs): Promise<object> {
    const { framework, issuer, patchContext, patcher } = needs;
    if (framework !== undefined && !this.deps.dryRun) {
      await patcher.patch(
        patchContext(framework, {
          id: "dry-run-0000",
          name: "dry-run",
          project_secret: "sk_proj_dry_run_full",
          preview_secret: "sk_proj_dry_run_preview",
          origins: [
            {
              pattern: issuer,
              kind: "primary",
            },
          ],
          created_at: "2026-04-21T14:03:11.000Z",
        }),
        {
          cwd: this.deps.cwd,
          dryRun: true,
          force: this.deps.force,
        },
      );
    }
    return {};
  }
}
