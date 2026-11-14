import { createZitadelClient } from "@/lib/backend";
import { deployInitialRelease } from "@/lib/environment";
import { isCancellation, toZitadelError } from "@/lib/errors";
import { abbreviate } from "@/lib/publish";
import { WHAT_CHANGED } from "@/lib/suggestion";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { userAgent } from "@/lib/user-agent";
import { reportWarning } from "@/lib/warnings";
import { WizardStep } from "@/lib/wizard";

import type { Fact, SetupServices } from "@/cli/commands/setup/shared";

/**
 * The message the first release carries.
 */
const INITIAL_DEPLOY_MESSAGE = "Initial deployment from setup";

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"answers" | "project">;

/**
 * Publishes what setup scaffolded, after the commit so the release records it,
 * so the sign-in setup asks the developer to verify next is served that release
 * rather than the newest stored revisions.
 *
 * @remarks
 * Narrated but never fatal: the app is scaffolded and committed, and a failure
 * leaves the deploy one command away.
 */
export class DoInitialDeploy extends WizardStep<
  "deploy",
  Fact<"deployment">,
  Needs,
  SetupServices
> {
  readonly key = "deploy";

  /**
   * Deploy `.zitadel/` to the project's primary origin, or say what a dry run
   * would.
   *
   *
   * Make the deploy, and say what happened.
   * @param needs - The answers and the project.
   * @param services - What the command provides.
   * @returns The deployment, or nothing when there was none.
   */
  async run(needs: Needs, services: SetupServices): Promise<Fact<"deployment">> {
    if (services.dryRun) {
      services.ui
        .begin("Deploying .zitadel/ to the project (dry run)")
        .done("Would deploy .zitadel/ to the project (dry run)");
      return { deployment: await undefined };
    }
    const deploying = services.ui.begin("Deploying .zitadel/ to the project");
    try {
      const deployment = await deployInitialRelease({
        client: createZitadelClient({
          userAgent: userAgent(),
          baseUrl: needs.answers.server,
          token: needs.project.project_secret,
          signal: services.signal,
        }),
        projectId: needs.project.id,
        cwd: services.cwd,
        env: services.env,
        json: services.isJson,
        color: services.isColored,
        message: INITIAL_DEPLOY_MESSAGE,
        narrate: services.narrate,
        suggest: services.suggest,
      });
      deploying.done(
        `Deployed ${escapeControlCharacters(abbreviate(deployment.contentHash))} to ${deployment.origins.length} ${new Intl.PluralRules("en").select(deployment.origins.length) === "one" ? "origin" : "origins"}`,
      );
      return { deployment: await deployment };
    } catch (error) {
      if (isCancellation(error) || services.signal.aborted) {
        throw error;
      }
      deploying.done("Left .zitadel/ undeployed");
      reportWarning(
        `The project was set up but its first deploy failed: ${toZitadelError(error).message}. Run ${services.suggest(
          {
            id: "deploy",
            flags: { message: WHAT_CHANGED },
          },
        )} to publish .zitadel/.`,
      );
      return { deployment: await undefined };
    }
  }
}
