import type { ConnectionEndpoints } from "@zitadel/config/idp";

import type { SchemaTarget } from "@/cli/commands/auth-method/command";
import type { GivenCredentials } from "@/lib/idp";
import { log } from "@/lib/log";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { WizardStep } from "@/lib/wizard";
import type { Connection, DocumentChange, SsoOptions } from "@/lib/zitadel";

import type { Summary, EnableServices } from "@/cli/commands/auth-method/sso/enable/shared";

/**
 * What the step reads from the steps before it.
 */
type Needs = Readonly<{
  target: SchemaTarget;
  candidate: Connection;
  preview: DocumentChange<Connection>;
  options: SsoOptions;
  summary: Summary;
  given: GivenCredentials;
}>;

/**
 * Settles the change to write, and checks that saving it would be accepted.
 */
export class BuildChange extends WizardStep<
  "change",
  Readonly<{ change: DocumentChange<Connection> }>,
  Needs,
  EnableServices
> {
  readonly key = "change";

  /**
   * Make the change again when a development run answered other endpoints, and
   * check it.
   *
   * @remarks
   * The credentials go before the files: saving writes the connection first, so
   * a write that then fails would leave a connection on disk whose credentials
   * were never stored, and the rerun would take it as reused and not ask for
   * them again. Saving's own refusals are checked here, before anything is
   * published, so a path it would refuse leaves the project's variables alone
   * too.
   *
   * @param needs - What was read and decided.
   * @param _services - What the command provides.
   * @returns The change.
   * @throws {@link ZitadelError} When saving the change would be refused.
   */
  async run(
    needs: Needs,
    _services: EnableServices,
  ): Promise<Readonly<{ change: DocumentChange<Connection> }>> {
    const change = this.withEndpoints(needs, needs.given.endpoints);
    if (needs.summary.reused) {
      log.done(`Reusing ${escapeControlCharacters(needs.summary.connection.path)}`);
    }
    await change.check(needs.target.store);
    return {
      change,
    };
  }

  /**
   * The change to write: the preview, or the same change made again with the
   * endpoints a development run answered.
   *
   * @remarks
   * The endpoints change only a new connection's body, never which files the
   * change writes.
   *
   * @param needs - What was read and decided.
   * @param endpoints - The endpoints a development run answered, if any.
   * @returns The change.
   */
  private withEndpoints(
    needs: Needs,
    endpoints: ConnectionEndpoints | undefined,
  ): DocumentChange<Connection> {
    if (endpoints === undefined) {
      return needs.preview;
    }
    const located = needs.candidate.withEndpoints(endpoints).document;
    return needs.target.config.connections.enable(needs.target.schema, located, needs.options);
  }
}
