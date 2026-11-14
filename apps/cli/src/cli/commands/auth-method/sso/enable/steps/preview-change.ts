import { drawMapping, payload } from "@/cli/commands/auth-method/sso/enable/shared";
import type { ClientId } from "@zitadel/config/idp";
import type { CredentialDelivery, PublishedCredentials } from "@/lib/idp";
import { escapeControlCharacters } from "@/lib/terminal-text";

import type { CommandResult } from "@/lib/oclif";
import { EndStep } from "@/lib/wizard";
import type { Connection, DocumentChange } from "@/lib/zitadel";

import type { Summary, EnableServices } from "@/cli/commands/auth-method/sso/enable/shared";

/**
 * Nothing sent to the project, as a dry run reports it.
 */
const NOTHING_PUBLISHED: PublishedCredentials = {
  clientId: undefined,
  secret: undefined,
};

/**
 * What the step reads from the steps before it.
 */
type Needs = Readonly<{
  flags: Readonly<{ clientId: ClientId | undefined }>;
  summary: Summary;
  preview: DocumentChange<Connection>;
  delivery: CredentialDelivery;
}>;

/**
 * What the step is given by the command.
 */
type Deps = Pick<EnableServices, "argsOf" | "dryRun" | "isJson" | "realRun" | "report">;

/**
 * Ends a dry run with what would be written and stored, before anything is
 * asked or read.
 */
export class PreviewChange extends EndStep<"preview", CommandResult, Needs> {
  readonly key = "preview";

  /**
   * @param deps - What the command gives the step.
   */
  private readonly deps: Deps;

  constructor(deps: Deps) {
    super();
    this.deps = deps;
  }

  /**
   * Whether the run only previews.
   *
   * @param _needs - What was read and decided.
   * @param this.deps - What the command provides.
   * @returns Whether to end here.
   */
  when(_needs: Needs): boolean {
    return this.deps.dryRun;
  }

  /**
   * Answer with the dry run's result: what would be written and stored, with
   * nothing asked or read.
   *
   * @remarks
   * The variables a dry run would store a credential in: a new connection
   * stores each credential that names a variable, and a credential the file
   * holds as a value names none, so it is left out. A reuse publishes only the
   * credentials it is given, and a dry run reads no piped secret, so only a
   * client id given with `--client-id` is listed.
   *
   * @param needs - What was read and decided.
   * @param this.deps - What the command provides.
   * @returns The dry run's result.
   */
  async run(needs: Needs): Promise<CommandResult> {
    const real = await this.deps.realRun();
    this.deps.report(needs.preview);
    if (!this.deps.isJson) {
      drawMapping(needs.preview);
    }
    const toStore = !needs.summary.reused
      ? [needs.delivery.names.clientId, needs.delivery.names.clientSecret].filter((name) => {
          return name !== undefined;
        })
      : needs.flags.clientId !== undefined && needs.delivery.names.clientId !== undefined
        ? [needs.delivery.names.clientId]
        : [];
    const said = [
      ...needs.preview.changedPaths.map((file) => {
        return `Would write ${file}`;
      }),
      ...(toStore.length > 0
        ? [
            `Would store ${new Intl.ListFormat("en", { type: "conjunction" }).format(toStore)} on the project`,
          ]
        : []),
    ];
    const title = escapeControlCharacters(
      said[0] === undefined ? "Nothing would change (dry run)" : `${said[0]} (dry run)`,
    );
    return {
      status: "ok",
      data: {
        ...payload({
          summary: needs.summary,
          change: needs.preview,
          published: NOTHING_PUBLISHED,
          names: needs.delivery.names,
        }),
        title,
        would_store: toStore,
        dry_run: true,
        next_args: [this.deps.argsOf(real)],
      },
      summary: {
        title,
        sections: [],
        lines: said.slice(1).map((line) => {
          return escapeControlCharacters(line);
        }),
      },
      next: { commands: [real] },
    };
  }
}
