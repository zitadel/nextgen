import { noticeLines, writtenLines } from "@/cli/commands/auth-method/command";
import {
  drawMapping,
  type EnableServices,
  type Fact,
  introductionLines,
  mappingLines,
  payload,
  publishedLines,
} from "@/cli/commands/auth-method/sso/enable/shared";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { Output } from "@/lib/ui";
import { WizardStep } from "@/lib/wizard";

/**
 * What the step reads from the steps before it.
 */
type Needs = Fact<
  "summary" | "change" | "written" | "published" | "delivery" | "target" | "provider"
>;

/**
 * What the step is given by the command.
 */
type Deps = Pick<EnableServices, "followUps" | "suggest">;

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
   * What the run told the person while it worked, as the lines a script reads.
   *
   * @remarks
   * A terminal was shown these as they happened, so it is given none of them
   * again.
   *
   * @param needs - What the run did.
   * @returns The lines, then a blank line, or nothing when there is none.
   */
  private said(needs: Needs): string[] {
    const lines = [
      ...introductionLines(needs),
      ...(needs.summary.reused
        ? [`Reusing ${escapeControlCharacters(needs.summary.connection.path)}`]
        : []),
      ...publishedLines(needs.published, needs.delivery.names),
      ...writtenLines(needs.change, needs.written),
      ...noticeLines(needs.change),
      ...(needs.written.length === 0 && needs.change.notices.length === 0
        ? [
            `${escapeControlCharacters(needs.target.schema.name)} and its login flow already offer ${escapeControlCharacters(needs.provider.displayName, { keepLayout: false })}`,
          ]
        : []),
      ...mappingLines(needs.change),
    ];

    return [...lines, ""];
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
      needs.delivery.unpublishedOf(needs.published).map((missing) => {
        return this.deps.suggest({
          id: "variable:set",
          args: { name: missing.name },
          flags: { secret: missing.secret },
        });
      }),
    );
    drawMapping(needs.change);
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
          lines: [
            ...(Output.screen ? [] : this.said(needs)),
            ...(unpublished && needs.delivery.areStored(needs.published)
              ? ["Its credentials are stored in your project."]
              : []),
          ],
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
