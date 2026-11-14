import type { EnableInput } from "@/cli/commands/auth-method/sso/enable/shared";
import { ProviderChoice } from "@/lib/idp";
import { WizardStep } from "@/lib/wizard";

/**
 * What the step is given by the command.
 */
type Deps = Readonly<{
  /**
   * Whether the run only previews.
   */
  dryRun: boolean;

  /**
   * Whether the run may not ask anything.
   */
  nonInteractive: boolean;
}>;

/**
 * Works out how the flags choose a provider, before anything is read or asked.
 */
export class ChooseProvider extends WizardStep<
  "choice",
  Readonly<{ choice: ProviderChoice }>,
  EnableInput
> {
  readonly key = "choice";

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
   * Read the flags that name the provider and describe a custom one.
   *
   * @param needs - What the run starts from.
   * @returns How the flags choose a provider.
   */
  async run(needs: EnableInput): Promise<Readonly<{ choice: ProviderChoice }>> {
    return {
      choice: ProviderChoice.fromFlags(needs.flags, {
        interactive: !this.deps.nonInteractive && !this.deps.dryRun,
      }),
    };
  }
}
