import { IDP_PROVIDERS } from "@zitadel/config/idp";

import { ENABLE_FLAG_KEYS } from "../../../../../lib/idp";
import { atLeastOne } from "../../../../../lib/oclif/rules";

/**
 * Refuses a run that names no provider. `--provider` is not `required` so that
 * oclif's own refusal, which carries no hint, never answers first; this one
 * names the next move.
 */
export const providerIsNamedRule = atLeastOne([ENABLE_FLAG_KEYS.provider], {
  message: "Name the provider to enable",
  hint: `Pass --provider, e.g. --provider ${IDP_PROVIDERS[0]}.`,
});
