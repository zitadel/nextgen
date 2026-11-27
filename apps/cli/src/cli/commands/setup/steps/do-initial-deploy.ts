import { createZitadelClient } from "@/lib/backend";
import { Environment } from "@/lib/environment";
import {
  isCancellation,
  toZitadelError,
  ZitadelError,
  ZitadelLibError,
  errorMessage,
} from "@/lib/errors";
import { abbreviate } from "@/lib/publish";
import { WHAT_CHANGED } from "@/lib/suggestion";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { Runtime } from "@/lib/runtime";
import { warnings } from "@/lib/ui";
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
 * What the step is given by the command.
 */
type Deps = Pick<SetupServices, "cwd" | "dryRun" | "env" | "narrate" | "signal" | "suggest" | "ui">;

/**
 * Publishes what setup scaffolded, after the commit so the release records it,
 * so the sign-in setup asks the developer to verify next is served that release
 * rather than the newest stored revisions.
 *
 * @remarks
 * Narrated but never fatal: the app is scaffolded and committed, and a failure
 * leaves the deploy one command away.
 */
export class DoInitialDeploy extends WizardStep<"deploy", Fact<"deployment">, Needs> {
  /**
   * The step's name, which a wizard refuses to hold twice.
   */
  readonly key = "deploy";

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
   * Deploy `.zitadel/` to the project's primary origin, or say what a dry run
   * would, and say what happened.
   *
   * @param needs - The answers and the project.
   * @returns The deployment, or nothing when there was none.
   */
  async run(needs: Needs): Promise<Fact<"deployment">> {
    if (this.deps.dryRun) {
      this.deps.ui
        .begin("Deploying .zitadel/ to the project (dry run)")
        .done("Would deploy .zitadel/ to the project (dry run)");
      return {
        deployment: undefined,
      };
    }
    const deploying = this.deps.ui.begin("Deploying .zitadel/ to the project");
    try {
      const deployment = await Environment.deployInitialRelease({
        client: createZitadelClient({
          userAgent: Runtime.current().userAgent(),
          baseUrl: needs.answers.server,
          token: needs.project.project_secret,
          signal: this.deps.signal,
        }),
        projectId: needs.project.id,
        cwd: this.deps.cwd,
        env: this.deps.env,
        message: INITIAL_DEPLOY_MESSAGE,
        narrate: this.deps.narrate,
      });
      deploying.done(
        `Deployed ${escapeControlCharacters(abbreviate(deployment.contentHash))} to ${deployment.origins.length} ${new Intl.PluralRules("en").select(deployment.origins.length) === "one" ? "origin" : "origins"}`,
      );
      return {
        deployment,
      };
    } catch (error) {
      if (this.deps.signal.aborted) {
        throw error;
      }
      if (error instanceof ZitadelLibError) {
        deploying.done("Left .zitadel/ undeployed");
        warnings.report(
          `The project was set up but its first deploy failed: ${toZitadelError(error).message}. Run ${this.deps.suggest(
            {
              id: "deploy",
              flags: { message: WHAT_CHANGED },
            },
          )} to publish .zitadel/.`,
        );
        return {
          deployment: undefined,
        };
      }
      if (error instanceof ZitadelError) {
        if (isCancellation(error)) {
          // A safety net: the project exists by now, so a first deploy that fails in a
          // way nobody anticipated is a warning, not a failed setup.
          deploying.done("Left .zitadel/ undeployed");
          warnings.report(
            `The project was set up but its first deploy failed: ${errorMessage(error)}. Run ${this.deps.suggest(
              {
                id: "deploy",
                flags: { message: WHAT_CHANGED },
              },
            )} to publish .zitadel/.`,
          );
          return {
            deployment: undefined,
          };
        }
        deploying.done("Left .zitadel/ undeployed");
        warnings.report(
          `The project was set up but its first deploy failed: ${error.message}. Run ${this.deps.suggest(
            {
              id: "deploy",
              flags: { message: WHAT_CHANGED },
            },
          )} to publish .zitadel/.`,
        );
        return {
          deployment: undefined,
        };
      }
      throw error;
    }
  }
}
