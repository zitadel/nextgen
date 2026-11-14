import type { CreatedProject } from "@/lib/backend";
import { WizardStep } from "@/lib/wizard";

import type { Fact, SetupServices } from "@/cli/commands/setup/shared";

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"patcher" | "patchContext" | "framework" | "issuer">;

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
export class CheckPatch extends WizardStep<"patchCheck", object, Needs, SetupServices> {
  readonly key = "patchCheck";

  /**
   * Run the patch without writing anything.
   *
   * @param needs - The patcher, the app and the issuer.
   * @param services - What the command provides.
   * @returns Nothing is added.
   * @throws {@link ZitadelError} With `E_CONFLICT` for a file it would refuse.
   */
  async run(needs: Needs, services: SetupServices): Promise<object> {
    const { framework, issuer, patchContext, patcher } = needs;
    if (framework !== undefined && !services.dryRun) {
      await patcher.patch(patchContext(framework, dryRunProject(issuer)), {
        cwd: services.cwd,
        dryRun: true,
        force: services.force,
      });
    }
    return {};
  }
}

/** A deterministic stand-in project for `--dry-run`, so no remote call is made. */
function dryRunProject(issuer: string): CreatedProject {
  return {
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
  };
}
