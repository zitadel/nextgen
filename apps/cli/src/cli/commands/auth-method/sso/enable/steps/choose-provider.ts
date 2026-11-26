import type { EnableServices, Fact } from "@/cli/commands/auth-method/sso/enable/shared";
import { type Refusal, refusalError } from "@/cli/core/refusal";
import {
  IdpProviderUnknownError,
  IdpSettingsInvalidError,
  IdpSettingsMissingError,
  IdpSettingsUnusedError,
  ProviderChoice,
} from "@/lib/idp";
import { WizardStep } from "@/lib/wizard";

/**
 * What a custom connection's setting the platform refuses is refused for.
 */
const SETTING_INVALID_REFUSAL = {
  message: "{message}",
  hint: "Fix {flag} and run the command again.",
  details: {
    flag: "{flag}",
  },
} as const satisfies Refusal;

/**
 * What custom connection settings given beside a catalog provider are refused
 * for.
 */
const SETTINGS_UNUSED_REFUSAL = {
  message: "{message}",
  hint: "Add {providerFlag} custom, or remove {pronoun}.",
  details: {
    flags: "{flags}",
  },
} as const satisfies Refusal;

/**
 * What a custom connection described without every setting it needs is
 * refused for.
 */
const SETTINGS_MISSING_REFUSAL = {
  message: "{message}",
  hint: "Describe the connection, e.g. {example}",
  details: {
    missing: "{missing}",
  },
} as const satisfies Refusal;

/**
 * What a provider that is neither in the catalog nor a custom connection is
 * refused for.
 */
const PROVIDER_UNKNOWN_REFUSAL = {
  message: "{message}",
  hint: "Use one of {list}.",
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
   * @throws {@link ZitadelError} When the provider is unknown, or the custom
   *   settings are refused, left out or given beside a catalog provider.
   */
  async run(needs: Fact<"flags">): Promise<Fact<"choice">> {
    try {
      return {
        choice: ProviderChoice.fromFlags(needs.flags, {
          interactive: !this.deps.nonInteractive && !this.deps.dryRun,
        }),
      };
    } catch (error) {
      if (error instanceof IdpSettingsInvalidError) {
        throw refusalError(SETTING_INVALID_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      if (error instanceof IdpSettingsUnusedError) {
        throw refusalError(SETTINGS_UNUSED_REFUSAL, {
          ...error,
          message: error.message,
          pronoun: new Intl.PluralRules("en").select(error.flags.length) === "one" ? "it" : "them",
        });
      }
      if (error instanceof IdpSettingsMissingError) {
        throw refusalError(SETTINGS_MISSING_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      if (error instanceof IdpProviderUnknownError) {
        throw refusalError(PROVIDER_UNKNOWN_REFUSAL, {
          ...error,
          message: error.message,
          list: error.known.join(", "),
        });
      }
      throw error;
    }
  }
}
