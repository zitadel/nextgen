import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";
import { closest } from "@/lib/zitadel/utils/spelling";
import { quote, readableProperties, standing, unreadable } from "@/lib/zitadel/rules/sso/shared";

export const IMPOSSIBLE_AUTO_CREATION_VERIFICATION: Rule = defineRule({
  id: "sso/impossible-auto-creation-verification",
  severity: "warning",
  // A required unique property the connection does not map is already named
  // by sso/impossible-auto-creation-data, or by sso/empty-claim-mapping when
  // the mapping fills nothing; this rule judges only those it maps.
  each: (config) => {
    const entries = standing(config);
    return config.flows.pinnedOffers.flatMap((offer) => {
      const connection = offer.connection;
      if (connection === undefined || !connection.createsUsers) {
        return [];
      }
      const entry = entries.find((candidate) => {
        return candidate.connection === connection;
      });
      // A verified_claims key no listing schema defines that is the nearest
      // name to a required property is a typo sso/orphaned-verification-key
      // reports.
      const meant =
        entry === undefined
          ? []
          : connection.verifications
              .filter((row) => {
                return unreadable(entry, row.property);
              })
              .map((row) => {
                return closest(row.property, readableProperties(entry));
              });
      const unverified = offer.schema.requiredUniqueByServer.filter((name) => {
        return (
          connection.maps(name) &&
          !meant.includes(name) &&
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
