import { IDP_PROVIDERS } from "@zitadel/config/idp";

import { listedProviders } from "../../../../../lib/auth-methods";
import { requirement, unmet } from "../../../../../lib/oclif/requirements";
import type { SchemaTarget } from "../../../requirements/target";

/**
 * The provider `auth-method sso disable` removes. It is always named, because
 * removing every provider at once would be a different, larger change; the
 * refusal lists the providers the schema offers, well-formed or not.
 */
export const providerToRemove = requirement<string>({
  refusal: {
    message: "Name the provider to remove",
    hint: "Pass --provider, e.g. --provider {example}. {schema} offers: {offered}.",
  },
  resolve: async ({ flags, resolved }) => {
    if (typeof flags.provider === "string") {
      return flags.provider;
    }
    const { schema } = resolved.target as SchemaTarget;
    return unmet({
      example: IDP_PROVIDERS[0],
      schema: schema.name,
      offered: listedProviders(schema.body).join(", ") || "none",
    });
  },
});
