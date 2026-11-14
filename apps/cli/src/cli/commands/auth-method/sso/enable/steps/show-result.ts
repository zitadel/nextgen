import type { FollowUps } from "@/cli/commands/auth-method/command";
import { drawMapping, payload, type Summary } from "@/cli/commands/auth-method/sso/enable/shared";
import type { CredentialDelivery, PublishedCredentials } from "@/lib/idp";
import type { CommandResult } from "@/lib/oclif";
import type { Suggest, SuggestedCommand } from "@/lib/suggestion";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { WizardStep } from "@/lib/wizard";
import type { Connection, DocumentChange } from "@/lib/zitadel";

/**
 * What the step reads from the steps before it.
 */
type Needs = Readonly<{
  summary: Summary;
  change: DocumentChange<Connection>;
  written: readonly string[];
  published: PublishedCredentials;
  delivery: CredentialDelivery;
}>;

/**
 * What the step is given by the command.
 */
type Deps = Readonly<{
  /**
   * The commands to run after a change: what leads, then deploy when a file changed.
   *
   * @param changed - Whether a file changed.
   * @param leading - What comes first.
   * @returns The commands, and their arguments.
   */
  followUps(changed: boolean, leading?: readonly SuggestedCommand[]): FollowUps;

  /**
   * Whether the run answers with JSON.
   */
  isJson: boolean;

  /**
   * Builds the commands the run suggests.
   */
  suggest: Suggest;
}>;

/**
 * Words what the run did as the command's result.
 */
export class ShowResult extends WizardStep<"result", Readonly<{ answer: CommandResult }>, Needs> {
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
  async run(needs: Needs): Promise<Readonly<{ answer: CommandResult }>> {
    const name = needs.summary.displayName;
    const unpublished = !needs.summary.reused || needs.written.length > 0;
    const followUps = this.deps.followUps(
      unpublished,
      needs.delivery.unpublishedOf(needs.published).map((missing) => {
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
            names: needs.delivery.names,
          }),
          next_args: followUps.args,
        },
        summary: {
          title: escapeControlCharacters(title),
          sections: [],
          lines:
            unpublished && needs.delivery.areStored(needs.published)
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
