import type { EnableServices, Fact } from "@/cli/commands/auth-method/sso/enable/shared";
import { log } from "@/lib/log";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { reportWarning } from "@/lib/warnings";
import { WizardStep } from "@/lib/wizard";

/**
 * What the step reads from the steps before it.
 */
type Needs = Fact<"target" | "provider" | "given" | "change">;

/**
 * What the step is given by the command.
 */
type Deps = Pick<EnableServices, "report" | "write">;

/**
 * Writes the configuration, and says what it said about the change.
 */
export class WriteFiles extends WizardStep<"write", Fact<"written">, Needs> {
  /**
   * The step's name, which a wizard refuses to hold twice.
   */
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
  async run(needs: Needs): Promise<Fact<"written">> {
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
