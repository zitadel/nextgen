import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";
import { quote, standing } from "@/lib/zitadel/rules/sso/shared";

export const INERT_CONNECTION: Rule = defineRule({
  id: "sso/inert-connection",
  severity: "warning",
  // A connection a flow offers but no schema lists is already refused by
  // sso/provider-id at the step, so it is not reported again here.
  each: (config) => {
    return standing(config).filter((entry) => {
      const offered = config.flows.offers.some((offer) => {
        return offer.slug === entry.slug;
      });
      // A connection the server already has is one `auth-method sso disable`
      // left behind on purpose, so it is not nagged about.
      return entry.listing.length === 0 && !offered && !config.connections.isDeployed(entry.slug);
    });
  },
  file: (fact) => {
    return fact.connection.path;
  },
  says: (fact) => {
    return `connection ${quote(fact.slug)} is listed in sso.providers by no schema, so no user type can use it. List ${quote(fact.slug)} in sso.providers of a schema, or delete this file.`;
  },
});
