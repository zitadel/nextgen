import { CUSTOM_PROVIDER, type ProviderSelection } from "@zitadel/config/idp";

import {
  checkGivenCustomFlags,
  type CustomFlagValues,
  customExample,
  customFlagValues,
  ENABLE_FLAG_KEYS,
  ENABLE_FLAG_NAMES,
  selectionFromFlags,
} from "../../../../../lib/idp";
import { requirement } from "../../../../../lib/oclif/requirements";

/**
 * The provider `auth-method sso enable` was asked for. `selection` is
 * undefined for a custom provider whose settings a person will be asked for
 * once everything that can fail has passed; `values` are the settings the
 * flags gave. A person at a terminal is asked for the settings they left out,
 * but later: here the ones they did give are only checked. A script, a dry run
 * or `--non-interactive` is held to the flags and told which are missing.
 */
type SsoProvider = {
  readonly selection: ProviderSelection | undefined;
  readonly values: CustomFlagValues;
};

function hasAllCustomSettings(values: CustomFlagValues): boolean {
  return (
    values.slug !== undefined && values.displayName !== undefined && values.issuer !== undefined
  );
}

export const ssoProvider = requirement<SsoProvider>({
  resolve: async ({ flags, meta }) => {
    const provider = String(flags[ENABLE_FLAG_KEYS.provider]);
    const values = customFlagValues(
      flags as {
        readonly [K in (typeof ENABLE_FLAG_KEYS)[keyof typeof ENABLE_FLAG_KEYS]]?: string;
      },
      ENABLE_FLAG_KEYS,
    );
    const interactive = !meta.nonInteractive && !meta.dryRun;
    const askLater = provider === CUSTOM_PROVIDER && interactive && !hasAllCustomSettings(values);
    if (askLater) {
      checkGivenCustomFlags(values, ENABLE_FLAG_NAMES);
    }
    return {
      selection: askLater
        ? undefined
        : selectionFromFlags(provider, values, ENABLE_FLAG_NAMES, customExample(ENABLE_FLAG_NAMES)),
      values,
    };
  },
});
