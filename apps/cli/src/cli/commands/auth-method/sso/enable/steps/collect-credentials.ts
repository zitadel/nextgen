import type { Fact } from "@/cli/commands/auth-method/sso/enable/shared";
import { WizardStep } from "@/lib/wizard";

/**
 * What the step reads from the steps before it.
 */
type Needs = Fact<"flags" | "prompt">;

/**
 * Asks for the client id and secret of the application registered with the
 * provider, once nothing is left that could refuse the run.
 */
export class CollectCredentials extends WizardStep<"credentials", Fact<"given">, Needs> {
  /**
   * The step's name, which a wizard refuses to hold twice.
   */
  readonly key = "credentials";

  /**
   * Ask, or take what the flags and the pipe gave.
   *
   * @param needs - The flags and the prompt.
   * @returns The credentials, and the endpoints a development run answered.
   */
  async run(needs: Needs): Promise<Fact<"given">> {
    return {
      given: await needs.prompt.ask(needs.flags.clientId),
    };
  }
}
