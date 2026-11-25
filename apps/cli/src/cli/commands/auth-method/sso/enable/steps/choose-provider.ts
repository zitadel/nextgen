import type { EnableServices, Fact } from "@/cli/commands/auth-method/sso/enable/shared";
import { CUSTOM_PROVIDER } from "@zitadel/config/idp";

import { type Refusal, refusalError } from "@/cli/core/refusal";
import {
  customExample,
  ENABLE_FLAG_NAMES,
  IdpProviderUnknownError,
  IdpSettingRefusedError,
  IdpSettingsConflictError,
  IdpSettingsMissingError,
  ProviderChoice,
} from "@/lib/idp";
import { WizardStep } from "@/lib/wizard";

/** How a setting the platform refuses is refused. */
const SETTING_REFUSED_REFUSAL = {
  message: "{message}",
  hint: "Fix {flag} and run the command again.",
  details: { flag: "{flag}" },
} as const satisfies Refusal;

/** How settings of a custom connection given with a catalog provider are refused. */
const SETTINGS_CONFLICT_REFUSAL = {
  message: "{message}",
  hint: "Add {provider} {custom}, or remove {them}.",
  details: { flags: "{flags}" },
} as const satisfies Refusal;

/** How a custom connection that lacks settings is refused. */
const SETTINGS_MISSING_REFUSAL = {
  message: "{message}",
  hint: "Describe the connection, e.g. {example}",
  details: { missing: "{missing}" },
} as const satisfies Refusal;

/** How a provider that is neither in the catalog nor custom is refused. */
const PROVIDER_UNKNOWN_REFUSAL = {
  message: "{message}",
  hint: "Use one of {known}.",
} as const satisfies Refusal;

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
    const choice = await Promise.resolve()
      .then(() => {
        return ProviderChoice.fromFlags(needs.flags, {
          interactive: !this.deps.nonInteractive && !this.deps.dryRun,
        });
      })
      .catch((error: unknown) => {
        if (error instanceof IdpSettingRefusedError) {
          throw Object.assign(
            refusalError(SETTING_REFUSED_REFUSAL, { message: error.message, flag: error.flag }),
            { cause: error },
          );
        }
        if (error instanceof IdpSettingsConflictError) {
          throw Object.assign(
            refusalError(SETTINGS_CONFLICT_REFUSAL, {
              message: error.message,
              provider: ENABLE_FLAG_NAMES.provider,
              custom: CUSTOM_PROVIDER,
              them: new Intl.PluralRules("en").select(error.given.length) === "one" ? "it" : "them",
              flags: error.given,
            }),
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
        if (error instanceof IdpProviderUnknownError) {
          throw Object.assign(
            refusalError(PROVIDER_UNKNOWN_REFUSAL, {
              message: error.message,
              known: error.known.join(", "),
            }),
            { cause: error },
          );
        }
        throw error;
      });

    return { choice };
  }
}
