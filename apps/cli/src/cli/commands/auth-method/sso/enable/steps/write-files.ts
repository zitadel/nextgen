import type { IdpProvider } from "@zitadel/config/idp";

import type { SchemaTarget } from "@/cli/commands/auth-method/command";
import type { GivenCredentials } from "@/lib/idp";
import { log } from "@/lib/log";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { reportWarning } from "@/lib/warnings";
import { WizardStep } from "@/lib/wizard";
import type { Change, Connection, DocumentChange } from "@/lib/zitadel";

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
 * What the step is given by the command.
 */
type Deps = Readonly<{
  /**
   * Says what a configuration change did, and what else the developer would not
   * otherwise see.
   *
   * @param change - The change.
   */
  report(change: Change): void;

  /**
   * Writes the change to the project's files.
   *
   * @param target - What the run read.
   * @param change - The change.
   * @returns The files written.
   */
  write(target: SchemaTarget, change: Change): Promise<readonly string[]>;
}>;

/**
 * Writes the configuration, and says what it said about the change.
 */
export class WriteFiles extends WizardStep<
  "write",
  Readonly<{ written: readonly string[] }>,
  Needs
> {
  readonly key = "write";

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
   * Save the change, and say what the configuration said about it and what else
   * the developer would not otherwise see.
   *
   * @remarks
   * A connection pointing somewhere other than the vendor is not what the
   * developer will want in the end, and nothing else would show it.
   *
   * @param needs - What was read and decided.
   * @returns The files written.
   */
  async run(needs: Needs): Promise<Readonly<{ written: readonly string[] }>> {
    const written = await this.deps.write(needs.target, needs.change);
    this.deps.report(needs.change);
    const endpointIssuer = needs.given.endpoints?.issuer;
    if (endpointIssuer !== undefined && endpointIssuer !== needs.provider.issuer) {
      reportWarning(`${needs.provider.displayName} points at ${endpointIssuer}, not the provider`);
    }
    if (written.length === 0 && needs.change.notices.length === 0) {
      log.info(
        `${escapeControlCharacters(needs.target.schema.name)} and its login flow already offer ${escapeControlCharacters(needs.provider.displayName, { keepLayout: false })}`,
      );
    }
    return {
      written,
    };
  }
}
