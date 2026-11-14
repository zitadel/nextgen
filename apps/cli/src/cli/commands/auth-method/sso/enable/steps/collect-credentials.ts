import type { ClientId } from "@zitadel/config/idp";

import type { CredentialPrompt, GivenCredentials } from "@/lib/idp";
import { WizardStep } from "@/lib/wizard";

import type { EnableServices } from "@/cli/commands/auth-method/sso/enable/shared";

/**
 * What the step reads from the steps before it.
 */
type Needs = Readonly<{
  flags: Readonly<{ clientId: ClientId | undefined }>;
  prompt: CredentialPrompt;
}>;

/**
 * Asks for the client id and secret of the application registered with the
 * provider, once nothing is left that could refuse the run.
 */
export class CollectCredentials extends WizardStep<
  "credentials",
  Readonly<{ given: GivenCredentials }>,
  Needs,
  EnableServices
> {
  readonly key = "credentials";

  /**
   * Ask, or take what the flags and the pipe gave.
   *
   * @param needs - The flags and the prompt.
   * @param _services - What the command provides.
   * @returns The credentials, and the endpoints a development run answered.
   */
  async run(
    needs: Needs,
    _services: EnableServices,
  ): Promise<Readonly<{ given: GivenCredentials }>> {
    return {
      given: await needs.prompt.ask(needs.flags.clientId),
    };
  }
}
