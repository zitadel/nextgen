import type { Fact, SetupServices } from "@/cli/commands/setup/shared";
import { scaffoldOf } from "@/cli/commands/setup/shared";

import type { FrameworkFacts } from "@/lib/orca";
import { issuerFromPort } from "@/lib/orca";
import { derivePosture } from "@/lib/orca/patchers/posture";
import type { CreatedProject } from "@/lib/backend";
import type { PatchContext } from "@/lib/orca/patchers/types";
import { WizardStep } from "@/lib/wizard";

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"flags" | "orca" | "app" | "answers" | "scaffoldedFramework">;

/**
 * What the step is given by the command.
 */
type Deps = Pick<SetupServices, "cliVersion" | "cwd" | "force">;

/**
 * Works out what the run will write, before anything is created.
 *
 * @remarks
 * The schema, flow, connection and policy files setup writes only once the
 * project exists: a conflict on one of those left the project behind, and the
 * rerun's `.env.local` kept pointing at it. Planned, and so refused, before
 * anything is written, a new app included. Read-only, so a dry run reports them
 * too.
 */
export class PlanConfiguration extends WizardStep<
  "plan",
  Fact<"issuer" | "rendererId" | "posture" | "patcher" | "patchContext" | "planned">,
  Needs
> {
  readonly key = "plan";

  /**
   * @param deps - What the command gives the step.
   */
  private readonly deps: Deps;

  constructor(deps: Deps) {
    super();
    this.deps = deps;
  }

  /**
   * Plan the configuration.
   *
   * @remarks
   * Fresh scaffolds keep the widgets' full-page chrome; a pre-existing route-based app gets
   * embeddable cards inside its own layout (ADR 044).
   *
   * @param needs - The flags, the app and the answers.
   * @returns What the later steps patch and write by.
   * @throws {@link ZitadelError} When a file setup will not replace is there.
   */
  async run(
    needs: Needs,
  ): Promise<Fact<"issuer" | "rendererId" | "posture" | "patcher" | "patchContext" | "planned">> {
    const { answers, app, flags, orca, scaffoldedFramework } = needs;
    const issuer = issuerFromPort(answers.devPort);
    const rendererId = flags.renderer ?? "react";
    const posture = derivePosture(app.framework, scaffoldedFramework);
    return {
      issuer,
      rendererId,
      posture,
      patcher: orca.patcherFor(app.framework),
      patchContext: (framework: FrameworkFacts, project: CreatedProject): PatchContext => {
        return {
          framework,
          rendererId,
          project,
          issuer,
          server: answers.server,
          cliVersion: this.deps.cliVersion,
          scaffoldedFramework,
          posture,
          preset: answers.preset,
          useCase: answers.useCase,
        };
      },
      planned: await scaffoldOf(this.deps.cwd, this.deps.force, answers),
    };
  }
}
