import { providerOf } from "@zitadel/config/idp";

import type { EnableServices, Fact } from "@/cli/commands/auth-method/sso/enable/shared";
import { type Refusal, refusalError } from "@/cli/core/refusal";
import {
  customExample,
  ENABLE_FLAG_NAMES,
  IdpSettingRefusedError,
  IdpSettingsMissingError,
} from "@/lib/idp";
import { WizardStep } from "@/lib/wizard";

/**
 * What the step reads from the steps before it.
 */
type Needs = Fact<"flags" | "choice" | "target">;

/** How a setting the platform refuses is refused. */
const SETTING_REFUSED_REFUSAL = {
  message: "{message}",
  hint: "Fix {flag} and run the command again.",
  details: { flag: "{flag}" },
} as const satisfies Refusal;

/** How a custom connection that lacks settings is refused. */
const SETTINGS_MISSING_REFUSAL = {
  message: "{message}",
  hint: "Describe the connection, e.g. {example}",
  details: { missing: "{missing}" },
} as const satisfies Refusal;

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
    const selection = await needs.choice
      .resolve(needs.target, this.deps.ask)
      .catch((error: unknown) => {
        if (error instanceof IdpSettingRefusedError) {
          throw Object.assign(
            refusalError(SETTING_REFUSED_REFUSAL, { message: error.message, flag: error.flag }),
            { cause: error },
          );
        }
        if (error instanceof IdpSettingsMissingError) {
          throw Object.assign(
            refusalError(SETTINGS_MISSING_REFUSAL, {
              message: error.message,
              example: customExample(ENABLE_FLAG_NAMES),
              missing: error.missing,
            }),
            { cause: error },
          );
        }
        throw error;
      });
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
