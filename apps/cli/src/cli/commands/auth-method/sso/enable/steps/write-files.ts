import { log } from "@/lib/log";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { reportWarning } from "@/lib/warnings";
import type { Change, UserSchema, Connection, DocumentChange } from "@/lib/zitadel";

import type { IdpProvider } from "@zitadel/config/idp";

import type { SchemaTarget } from "@/cli/commands/auth-method/command";
import type { GivenCredentials } from "@/lib/idp";
import { WizardStep } from "@/lib/wizard";

import type { EnableServices } from "@/cli/commands/auth-method/sso/enable/shared";

/**
 * What the step reads from the steps before it.
 */
type Needs = Readonly<{
  target: SchemaTarget;
  provider: IdpProvider;
  given: GivenCredentials;
  change: DocumentChange<Connection>;
}>;

/**
 * Writes the configuration, and says what it said about the change.
 */
export class WriteFiles extends WizardStep<
  "write",
  Readonly<{ written: readonly string[] }>,
  Needs,
  EnableServices
> {
  readonly key = "write";

  /**
   * Save the change.
   *
   * @param needs - What was read and decided.
   * @param services - What the command provides.
   * @returns The files written.
   */
  async run(
    needs: Needs,
    services: EnableServices,
  ): Promise<Readonly<{ written: readonly string[] }>> {
    const written = await services.write(needs.target, needs.change);
    this.reportOutcome(services, {
      change: needs.change,
      written,
      provider: needs.provider,
      given: needs.given,
      schema: needs.target.schema,
    });
    return {
      written,
    };
  }

  /**
   * Say what the configuration said about the change, and what else the
   * developer would not otherwise see.
   *
   *
   * @remarks
   * A connection pointing somewhere other than the vendor is not what the developer will want in
   * the end, and nothing else would show it.
   *
   * @param outcome - The change, the files written, the provider, the
   *   credentials and endpoints the run was given, and the schema.
   */
  private reportOutcome(services: EnableServices, outcome: Outcome): void {
    const provider = outcome.provider;
    services.report(outcome.change);
    const endpointIssuer = outcome.given.endpoints?.issuer;
    if (endpointIssuer !== undefined && endpointIssuer !== provider.issuer) {
      reportWarning(`${provider.displayName} points at ${endpointIssuer}, not the provider`);
    }
    if (outcome.written.length === 0 && outcome.change.notices.length === 0) {
      log.info(
        `${escapeControlCharacters(outcome.schema.name)} and its login flow already offer ${escapeControlCharacters(provider.displayName, { keepLayout: false })}`,
      );
    }
  }
}

/**
 * What `reportOutcome` reports on.
 */
type Outcome = {
  readonly change: Change;
  readonly written: readonly string[];
  readonly provider: IdpProvider;
  readonly given: GivenCredentials;
  readonly schema: UserSchema;
};
