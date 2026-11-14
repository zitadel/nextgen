import { providerOf } from "@zitadel/config/idp";

import type { EnableServices, Fact } from "@/cli/commands/auth-method/sso/enable/shared";
import { WizardStep } from "@/lib/wizard";

/**
 * What the step reads from the steps before it.
 */
type Needs = Fact<"flags" | "choice" | "target">;

/**
 * What the step is given by the command.
 */
type Deps = Pick<EnableServices, "ask" | "dryRun">;

/**
 * Settles which provider the run adds, asking for what the flags left out of a
 * custom one.
 */
export class SelectConnection extends WizardStep<
  "selection",
  Fact<"selection" | "provider" | "options">,
  Needs
> {
  /**
   * The step's name, which a wizard refuses to hold twice.
   */
  readonly key = "selection";

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
   * Resolve the provider.
   *
   * @param needs - The flags, how they choose a provider, and what was read.
   * @returns The provider and the options the edit is made with.
   */
  async run(needs: Needs): Promise<Fact<"selection" | "provider" | "options">> {
    const selection = await needs.choice.resolve(needs.target, this.deps.ask);
    return {
      selection,
      provider: providerOf(selection),
      options: {
        clientId: needs.flags.clientId,
        given: needs.choice.givenSettings(selection),
        dryRun: this.deps.dryRun,
      },
    };
  }
}
