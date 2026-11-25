import type { EnableServices, Fact } from "@/cli/commands/auth-method/sso/enable/shared";
import { ProviderChoice } from "@/lib/idp";
import { WizardStep } from "@/lib/wizard";

/**
 * What the step is given by the command.
 */
type Deps = Pick<EnableServices, "dryRun" | "nonInteractive">;

/**
 * Works out how the flags choose a provider, before anything is read or asked.
 */
export class ChooseProvider extends WizardStep<"choice", Fact<"choice">, Fact<"flags">> {
  /**
   * The step's name, which a wizard refuses to hold twice.
   */
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
  async run(needs: Fact<"flags">): Promise<Fact<"choice">> {
    return {
      choice: ProviderChoice.fromFlags(needs.flags, {
        interactive: !this.deps.nonInteractive && !this.deps.dryRun,
      }),
    };
  }
}
