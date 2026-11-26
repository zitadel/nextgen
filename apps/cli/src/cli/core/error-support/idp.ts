import {
  IdpProviderUnknownError,
  IdpSettingsInvalidError,
  IdpSettingsMissingError,
  IdpSettingsUnusedError,
} from "@/lib/idp";

import type { Refusal } from "@/cli/core/refusal";
import { derived, type Wording } from "./wording";

/** How a custom connection setting that cannot be used is refused. */
const SETTINGS_INVALID_REFUSAL = {
  message: "{message}",
  hint: "Fix {flag} and run the command again.",
} as const satisfies Refusal;

/** How custom connection settings given beside a catalog provider are refused. */
const SETTINGS_UNUSED_REFUSAL = {
  message: "{message}",
  hint: "Add {providerFlag} custom, or remove {pronoun}.",
  details: {
    flags: "{flags}",
  },
} as const satisfies Refusal;

/** How a custom connection described without every setting it needs is refused. */
const SETTINGS_MISSING_REFUSAL = {
  message: "{message}",
  hint: "Describe the connection, e.g. {example}",
  details: {
    missing: "{missing}",
  },
} as const satisfies Refusal;

/** How a provider that is neither in the catalog nor a custom connection is refused. */
const PROVIDER_UNKNOWN_REFUSAL = {
  message: "{message}",
  hint: "Use one of {list}.",
  details: {},
} as const satisfies Refusal;

/** How the errors of `@/lib/idp` are worded, most specific class first. */
export const IDP_WORDINGS: readonly Wording[] = [
  [IdpSettingsInvalidError, SETTINGS_INVALID_REFUSAL],
  derived(IdpSettingsUnusedError, SETTINGS_UNUSED_REFUSAL, (error) => {
    return {
      values: {
        pronoun: new Intl.PluralRules("en").select(error.flags.length) === "one" ? "it" : "them",
      },
    };
  }),
  [IdpSettingsMissingError, SETTINGS_MISSING_REFUSAL],
  derived(IdpProviderUnknownError, PROVIDER_UNKNOWN_REFUSAL, (error) => {
    return {
      values: {
        list: error.known.join(", "),
      },
    };
  }),
];
