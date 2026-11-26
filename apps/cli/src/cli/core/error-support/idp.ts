import {
  IdpSettingsInvalidError,
  IdpSettingsMissingError,
  IdpSettingsUnusedError,
} from "@/lib/idp";

import { type Advice, derived, type Wording } from "./wording";

/** How a custom connection setting that cannot be used is refused. */
const SETTINGS_INVALID_ADVICE = {
  hint: "Fix {flag} and run the command again.",
} as const satisfies Advice;

/** How custom connection settings given beside a catalog provider are refused. */
const SETTINGS_UNUSED_ADVICE = {
  hint: "Add {providerFlag} custom, or remove {pronoun}.",
  details: {
    flags: "{flags}",
  },
} as const satisfies Advice;

/** How a custom connection described without every setting it needs is refused. */
const SETTINGS_MISSING_ADVICE = {
  hint: "Describe the connection, e.g. {example}",
  details: {
    missing: "{missing}",
  },
} as const satisfies Advice;

/** How the errors of `@/lib/idp` are advised on, each for exactly its class. */
export const IDP_WORDINGS: readonly Wording[] = [
  [IdpSettingsInvalidError, SETTINGS_INVALID_ADVICE],
  derived(IdpSettingsUnusedError, SETTINGS_UNUSED_ADVICE, (error) => {
    return {
      values: {
        pronoun: new Intl.PluralRules("en").select(error.flags.length) === "one" ? "it" : "them",
      },
    };
  }),
  [IdpSettingsMissingError, SETTINGS_MISSING_ADVICE],
];
