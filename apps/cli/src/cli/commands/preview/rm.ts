import { Args } from "@oclif/core";

import { PreviewService } from "@/lib/backend";
import { CommandGroups } from "@/cli/commands/groups";
import type { Admitted, CommandResult } from "@/cli/core";
import { dryRunResult } from "@/cli/core/crud/shared";
import { Settled } from "@/cli/core/destructive";
import { deletedData } from "@/cli/core/envelope";
import { filled, type Refused, taken } from "@/cli/core/flags";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { ServerCommand } from "@/cli/commands/server-command";
import { Previewable } from "@/cli/core/previewable";
import { Destructive } from "@/cli/core/destructive";
import { PreviewCommand } from "@/cli/core";
import { Telemetered } from "@/cli/telemetry/telemetered";

/**
 * The preview URL to remove. It refuses a blank value, and drops a trailing
 * slash that names the same origin but, sent as typed, would match nothing.
 */
const URL = {
  schema: filled.transform((url) => {
    return url.replace(/\/+$/, "");
  }),
  refusal: {
    message: "{input} was given an empty value",
    hint: "Pass a value for {input}, or omit it entirely.",
  },
} as const satisfies Refused<string>;

/**
 * `zitadel preview rm <url>` — end a live preview before it expires.
 *
 * The URL stops being served at once; the deployments to it stay in the
 * history. Idempotent on the server, but destructive from the caller's point
 * of view.
 */
export default class PreviewRm extends Telemetered(
  Destructive(
    Previewable(ServerCommand(PreviewCommand)),
    "Remove the preview without the confirmation prompt. Required when non-interactive.",
  ),
) {
  static override description = "Remove a live preview from the project.";
  static override group = CommandGroups.releases;
  static override groupOrder = 2;

  static override examples = [
    "<%= config.bin %> preview rm https://acme-git-sso-acmeinc.vercel.app",
    "<%= config.bin %> preview rm https://acme-git-sso-acmeinc.vercel.app --force",
  ];
  static override args = {
    url: Args.custom<string>({
      parse: taken(URL),
    })({
      required: true,
      description: "The preview URL to remove.",
    }),
  };

  /**
   * Says what stopping the preview would do, without connecting or removing.
   *
   * @param input - The flags and arguments of the run.
   * @returns The dry run's envelope.
   */
  protected async preview({ args }: Admitted<typeof PreviewRm>): Promise<CommandResult> {
    return dryRunResult({
      verb: "stop",
      topic: "preview",
      noun: "serving",
      id: args.url,
      next: await this.realRun(),
    });
  }

  /**
   * Stops serving the preview, once the person has agreed or forced it. The
   * server answers 204 whether or not the URL was live, so a typo would
   * otherwise read as a removal; the preview is looked up before asking, so
   * nobody confirms removing what is not there.
   *
   * @param input - The flags and arguments of the run.
   * @returns The envelope of the removal.
   */
  protected async apply({ args }: Admitted<typeof PreviewRm>): Promise<CommandResult> {
    return await this.confirmed({
      verb: "remove",
      name: `stop serving ${args.url}`,
      message: async () => {
        return `Stop serving ${args.url} for ${await this.projectOnServer()}?`;
      },
      prepare: async () => {
        const previewService = await this.service(PreviewService);
        const previews = await previewService.list();
        if (
          !previews.some((preview) => {
            return preview.origin === args.url;
          })
        ) {
          return new Settled({
            status: "skipped",
            reason: "not-live",
            summary: {
              title: "Nothing was removed",
              sections: [],
              lines: [`${escapeControlCharacters(args.url)} is not a live preview of the project`],
            },
            next: { commands: [this.suggest({ id: "preview:list" })] },
          });
        }

        return undefined;
      },
      apply: async (consent) => {
        const previewService = await this.service(PreviewService, consent);
        await previewService.remove(args.url);
        const title = `Stopped serving ${escapeControlCharacters(args.url)}`;
        return {
          status: "ok",
          data: deletedData({ title, url: args.url }),
          summary: {
            title,
            sections: [],
          },
        };
      },
    });
  }
}
