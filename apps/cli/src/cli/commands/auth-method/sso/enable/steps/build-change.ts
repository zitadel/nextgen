import type { SchemaTarget } from "@/cli/commands/auth-method/command";
import type { GivenCredentials } from "@/lib/idp";
import { log } from "@/lib/log";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { WizardStep } from "@/lib/wizard";
import type { ClaimChoice, Connection, DocumentChange, SsoOptions } from "@/lib/zitadel";

import type { Summary } from "@/cli/commands/auth-method/sso/enable/shared";

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
  claims: ClaimChoice | undefined;
  answered: ClaimChoice | undefined;
}>;

/**
 * Settles the change to write, and checks that saving it would be accepted.
 */
export class BuildChange extends WizardStep<
  "change",
  Readonly<{ change: DocumentChange<Connection> }>,
  Needs
> {
  readonly key = "change";

  /**
   * Make the change again when a development run answered other endpoints, and
   * check it.
   *
   * @remarks
   * The change is the preview, or the same change made again with the endpoints
   * a development run answered, or the claims the person chose when the flags
   * mapped none. The endpoints change only a new connection's body, never which
   * files the change writes; the claims can add properties to the schema and
   * fields to the login flow.
   *
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
  async run(needs: Needs): Promise<Readonly<{ change: DocumentChange<Connection> }>> {
    const claimed =
      needs.answered === undefined
        ? needs.candidate
        : needs.candidate.withClaims(needs.answered).document;
    const change =
      needs.given.endpoints === undefined && needs.answered === needs.claims
        ? needs.preview
        : needs.target.config.connections.enable(
            needs.target.schema,
            needs.given.endpoints === undefined
              ? claimed
              : claimed.withEndpoints(needs.given.endpoints).document,
            {
              ...needs.options,
              attributes: needs.answered?.created,
            },
          );
    if (needs.summary.reused) {
      log.done(`Reusing ${escapeControlCharacters(needs.summary.connection.path)}`);
    }
    await change.check(needs.target.store);
    return {
      change,
    };
  }
}
