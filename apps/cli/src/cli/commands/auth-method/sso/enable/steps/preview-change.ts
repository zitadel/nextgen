import {
  drawMapping,
  NOTHING_PUBLISHED,
  payload,
} from "@/cli/commands/auth-method/sso/enable/shared";
import type { ClientIdVariable, ClientSecretVariable, ClientId } from "@zitadel/config/idp";
import type { CredentialNames, CredentialDelivery } from "@/lib/idp";
import type { SuggestedCommand } from "@/lib/suggestion";
import { escapeControlCharacters } from "@/lib/terminal-text";

import type { JsonEnvelope } from "@/lib/oclif";
import { EndStep } from "@/lib/wizard";
import type { Connection, DocumentChange } from "@/lib/zitadel";

import type { Summary, EnableServices } from "@/cli/commands/auth-method/sso/enable/shared";

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
 * Ends a dry run with what would be written and stored, before anything is
 * asked or read.
 */
export class PreviewChange extends EndStep<"preview", JsonEnvelope, Needs, EnableServices> {
  readonly key = "preview";

  /**
   * Whether the run only previews.
   *
   * @param _needs - What was read and decided.
   * @param services - What the command provides.
   * @returns Whether to end here.
   */
  when(_needs: Needs, services: EnableServices): boolean {
    return services.dryRun;
  }

  /**
   * Answer with the dry run's result.
   *
   * @param needs - What was read and decided.
   * @param services - What the command provides.
   * @returns The dry run's result.
   */
  async run(needs: Needs, services: EnableServices): Promise<JsonEnvelope> {
    const real = await services.realRun();
    return this.previewResult(
      services,
      needs.summary,
      needs.preview,
      needs.delivery.names,
      needs.flags.clientId,
      real,
    );
  }

  /**
   * The result of a dry run: what would be written and stored, with nothing
   * asked or read.
   *
   * @param summary - What the run says about the connection.
   * @param change - The change worked out before anything was asked.
   * @param names - The variables the credentials would go to.
   * @param givenClientId - The client id `--client-id` gave, if any.
   * @param real - The real run, as the developer typed it.
   * @returns The dry run's result.
   */
  private previewResult(
    services: EnableServices,
    summary: Summary,
    change: DocumentChange<Connection>,
    names: CredentialNames,
    givenClientId: ClientId | undefined,
    real: SuggestedCommand,
  ): JsonEnvelope {
    services.report(change);
    if (!services.isJson) {
      drawMapping(change);
    }
    const toStore = this.wouldStore(summary.reused, names, givenClientId);
    const stores =
      toStore.length > 0
        ? [
            `Would store ${new Intl.ListFormat("en", { type: "conjunction" }).format(toStore)} on the project`,
          ]
        : [];
    const said = [
      ...change.changedPaths.map((file) => {
        return `Would write ${file}`;
      }),
      ...stores,
    ];

    const title = escapeControlCharacters(
      said[0] === undefined ? "Nothing would change (dry run)" : `${said[0]} (dry run)`,
    );

    return services.emit({
      status: "ok",
      data: {
        ...payload({
          summary,
          change,
          published: NOTHING_PUBLISHED,
          names,
        }),
        title,
        would_store: toStore,
        dry_run: true,
        next_args: [services.argsOf(real)],
      },
      summary: {
        title,
        sections: [],
        lines: said.slice(1).map((line) => {
          return escapeControlCharacters(line);
        }),
      },
      next: { commands: [real] },
    });
  }

  /**
   * The variables a dry run would store a credential in.
   *
   * @remarks
   * Nothing is asked or read: a reuse publishes only the credentials it is
   * given, and a dry run reads no piped secret, so none is listed.
   *
   * @param reused - Whether the connection was already in the project.
   * @param names - The connection's variables.
   * @param givenClientId - The client id `--client-id` gave, if any.
   * @returns The variables.
   */
  private wouldStore(
    reused: boolean,
    names: CredentialNames,
    givenClientId: ClientId | undefined,
  ): readonly (ClientIdVariable | ClientSecretVariable)[] {
    // A credential the file holds as a value names no variable, so it is left out.
    if (!reused) {
      return [names.clientId, names.clientSecret].filter((name) => {
        return name !== undefined;
      });
    }
    if (givenClientId !== undefined && names.clientId !== undefined) {
      return [names.clientId];
    }
    return [];
  }
}
