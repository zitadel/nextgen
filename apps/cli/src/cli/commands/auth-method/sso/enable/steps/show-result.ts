import {
  drawMapping,
  type EnableServices,
  type Fact,
  payload,
} from "@/cli/commands/auth-method/sso/enable/shared";
import { unpublished as unpublishedCredentials } from "@/lib/idp";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { WizardStep } from "@/lib/wizard";

/**
 * What the step reads from the steps before it.
 */
type Needs = Fact<"summary" | "change" | "written" | "published" | "names" | "answered">;

/**
 * What the step is given by the command.
 */
type Deps = Pick<EnableServices, "followUps" | "isJson" | "suggest">;

/**
 * Words what the run did as the command's result.
 */
export class ShowResult extends WizardStep<"result", Fact<"answer">, Needs> {
  /**
   * The step's name, which a wizard refuses to hold twice.
   */
  readonly key = "result";

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
   * Build the result of a run that wrote the configuration and published the
   * credentials.
   *
   * @remarks
   * The title says whether the provider is configured, and the terminal and the
   * envelope say it in these same words: it is "already configured" when the
   * connection was reused and no file was written.
   *
   * @param needs - What the run did.
   * @returns The result the command answers with.
   */
  async run(needs: Needs): Promise<Fact<"answer">> {
    const name = needs.summary.displayName;
    const unpublished = !needs.summary.reused || needs.written.length > 0;
    const followUps = this.deps.followUps(
      unpublished,
      unpublishedCredentials([
        {
          name: needs.names.clientId,
          secret: false,
          published: needs.published.clientId,
        },
        {
          name: needs.names.clientSecret,
          secret: true,
          published: needs.published.secret?.published,
        },
      ]).map((missing) => {
        return this.deps.suggest({
          id: "variable:set",
          args: { name: missing.name },
          flags: { secret: missing.secret },
        });
      }),
    );
    if (!this.deps.isJson) {
      drawMapping(needs.change);
    }
    const title = unpublished
      ? `${name} sign-in is configured locally`
      : `${name} sign-in is already configured locally`;
    return {
      answer: {
        status: "ok",
        data: {
          title,
          ...payload({
            summary: needs.summary,
            change: needs.change,
            published: needs.published,
            names: needs.names,
            claims: needs.answered,
          }),
          next_args: followUps.args,
        },
        summary: {
          title: escapeControlCharacters(title),
          sections: [],
          lines:
            unpublished &&
            needs.published.secret?.published === "stored" &&
            needs.published.clientId !== "deferred" &&
            needs.published.clientId !== "failed"
              ? ["Its credentials are stored in your project."]
              : [],
        },
        next: unpublished
          ? {
              actions: [
                `Deploy it to make ${name} sign-in available in your app, then reload the app and test it`,
              ],
              commands: followUps.commands,
            }
          : { commands: followUps.commands },
      },
    };
  }
}
