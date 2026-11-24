import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";
import { quote } from "@/lib/zitadel/rules/sso/shared";

export const IMPOSSIBLE_AUTO_CREATION_VERIFICATION: Rule = defineRule({
  id: "sso/impossible-auto-creation-verification",
  severity: "warning",
  // A required unique property the connection does not map is already named
  // by sso/impossible-auto-creation-data, or by sso/empty-claim-mapping when
  // the mapping fills nothing; this rule judges only those it maps.
  each: (config) => {
    return config.flows.pinnedOffers.flatMap((offer) => {
      const connection = offer.connection;
      if (connection === undefined || !connection.createsUsers) {
        return [];
      }
      const unverified = offer.schema.requiredUniqueByServer.filter((name) => {
        return (
          connection.maps(name) &&
          !connection.verifications.some((row) => {
            return row.property === name;
          })
        );
      });
      if (unverified.length === 0) {
        return [];
      }
      return [{ ...offer, connection, unverified }];
    });
  },
  file: (fact) => {
    return fact.flow.path;
  },
  steps: {
    step: (fact) => {
      return fact.step.name;
    },
    cause: (fact) => {
      return fact.slug;
    },
  },
  says: (fact, where) => {
    const names = fact.unverified.map(quote).join(", ");
    return `${where}: ${quote(fact.slug)} creates users automatically, but ${fact.schema.path} requires unique ${names} and verified_claims of ${fact.connection.path} has no entry for ${names}, so ${names} always arrives unverified and automatic creation can never complete. Add ${names} to verified_claims in ${fact.connection.path}, naming the claim that verifies it.`;
  },
});
