import { Args, Flags } from "@oclif/core";

import { PreviewService } from "@/lib/backend";
import { type Admitted, CommandGroups, type JsonEnvelope, PreviewCommand } from "@/lib/oclif";
import { dryRunResult } from "@/lib/oclif/crud/shared";
import { Destructive, Settled } from "@/lib/oclif/destructive";
import { deletedData } from "@/lib/oclif/envelope";
import { filled, type Refused, taken } from "@/lib/oclif/flags";
import { escapeControlCharacters } from "@/lib/terminal-text";

/**
 * The preview URL to remove. It refuses a blank value, and drops a trailing
 * slash that names the same origin but, sent as typed, would match nothing.
 */
const URL: Refused<string> = {
  schema: filled.transform((url) => {
    return url.replace(/\/+$/, "");
  }),
  refusal: {
    message: "{input} was given an empty value",
    hint: "Pass a value for {input}, or omit it entirely.",
  },
};

/**
 * `zitadel preview rm <url>` — end a live preview before it expires.
 *
 * The URL stops being served at once; the deployments to it stay in the
 * history. Idempotent on the server, but destructive from the caller's point
 * of view.
 */
export default class PreviewRm extends Destructive(PreviewCommand) {
  static override description = "Remove a live preview from the project.";
  static override group = CommandGroups.configuration;

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
  static override flags = {
    // `--force` is per command, not global: here it permits a removal.
    force: Flags.boolean({
      char: "f",
      description:
        "Remove the preview without the confirmation prompt. Required when non-interactive.",
    }),
  };

  protected async execute({ args }: Admitted<typeof PreviewRm>): Promise<JsonEnvelope> {
    return this.emit(
      await this.confirmed({
        verb: "remove",
        name: `stop serving ${args.url}`,
        message: async () => {
          const { projectId, server } = await this.connect();
          return `Stop serving ${args.url} for project ${projectId} on ${server.replace(/^https?:\/\//, "")}?`;
        },
        preview: async () => {
          return dryRunResult({
            verb: "stop",
            topic: "preview",
            noun: "serving",
            id: args.url,
            next: await this.realRun(),
          });
        },
        prepare: async () => {
          const { client, projectId } = await this.connect();
          const previewService = new PreviewService(client, projectId);
          const previews = await previewService.list();
          // The server answers 204 whether or not the URL was live, so a typo
          // would otherwise read as a removal. Checked before asking, so
          // nobody confirms removing what is not there.
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
                lines: [
                  `${escapeControlCharacters(args.url)} is not a live preview of the project`,
                ],
              },
              next: { commands: [this.suggest("preview:list")] },
            });
          }
          return {
            client,
            projectId,
          };
        },
        apply: async (consent, { client, projectId }) => {
          const previewService = new PreviewService(consent.unlock(client), projectId);
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
      }),
    );
  }
}
