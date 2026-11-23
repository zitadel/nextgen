import { type Fact, introductionLines } from "@/cli/commands/auth-method/sso/enable/shared";
import { log } from "@/lib/ui";
import { WizardStep } from "@/lib/wizard";

/**
 * What the step reads from the steps before it.
 */
type Needs = Fact<"target" | "provider" | "summary">;

/**
 * Says what the run addresses and what to register with the provider.
 *
 * @remarks
 * Said before a dry run returns, so a preview is enough to register the client.
 */
export class IntroduceProvider extends WizardStep<"introduce", object, Needs> {
  /**
   * The step's name, which a wizard refuses to hold twice.
   */
  readonly key = "introduce";

  /**
   * Print the introduction: what the run addresses and what to register with
   * the provider.
   *
   * @remarks
   * A custom provider has no console to send the developer to: it is theirs, and
   * the issuer they gave is the only address known.
   *
   * @param needs - What was read and decided.
   * @returns Nothing is added.
   */
  async run(needs: Needs): Promise<object> {
    for (const line of introductionLines(needs)) {
      log.info(line);
    }

    return {};
  }
}
