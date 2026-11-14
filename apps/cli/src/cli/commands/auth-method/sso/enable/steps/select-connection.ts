import { type IdpProvider, type ProviderSelection, providerOf } from "@zitadel/config/idp";

import type { SchemaTarget } from "@/cli/commands/auth-method/command";
import type { ProviderChoice } from "@/lib/idp";
import { WizardStep } from "@/lib/wizard";
import type { SsoOptions } from "@/lib/zitadel";

import type { EnableInput, EnableServices } from "@/cli/commands/auth-method/sso/enable/shared";

/**
 * What the run decided about the provider.
 */
type Selected = Readonly<{
  /**
   * The provider, as it was chosen.
   */
  selection: ProviderSelection;

  /**
   * The provider's own facts.
   */
  provider: IdpProvider;

  /**
   * What the configuration is edited with.
   */
  options: SsoOptions;
}>;

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
  Selected,
  EnableInput & Readonly<{ choice: ProviderChoice; target: SchemaTarget }>
> {
  readonly key = "selection";

  /**
   * @param deps - What the command gives the step.
   */
  private readonly deps: Deps;

  constructor(deps: Deps) {
    super();
    this.deps = deps;
  }

  /**
   * Resolve the provider.
   *
   * @param needs - The flags, how they choose a provider, and what was read.
   * @param this.deps - What the command provides.
   * @returns The provider and the options the edit is made with.
   */
  async run(
    needs: EnableInput & Readonly<{ choice: ProviderChoice; target: SchemaTarget }>,
  ): Promise<Selected> {
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
