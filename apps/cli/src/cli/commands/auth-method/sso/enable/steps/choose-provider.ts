import { ProviderChoice } from "@/lib/idp";
import { WizardStep } from "@/lib/wizard";

import type { EnableInput, EnableServices } from "@/cli/commands/auth-method/sso/enable/shared";

/**
 * Works out how the flags choose a provider, before anything is read or asked.
 */
export class ChooseProvider extends WizardStep<
  "choice",
  Readonly<{ choice: ProviderChoice }>,
  EnableInput,
  EnableServices
> {
  readonly key = "choice";

  /**
   * Read the flags that name the provider and describe a custom one.
   *
   * @param needs - What the run starts from.
   * @param services - What the command provides.
   * @returns How the flags choose a provider.
   */
  async run(
    needs: EnableInput,
    services: EnableServices,
  ): Promise<Readonly<{ choice: ProviderChoice }>> {
    return {
      choice: ProviderChoice.fromFlags(needs.flags, {
        interactive: !services.nonInteractive && !services.dryRun,
      }),
    };
  }
}
