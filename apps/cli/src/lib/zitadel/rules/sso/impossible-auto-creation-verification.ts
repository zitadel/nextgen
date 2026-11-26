import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";
import { closest } from "@/lib/zitadel/utils/spelling";
import { quote, readableProperties, standing, unreadable } from "@/lib/zitadel/rules/sso/shared";

/**
 * A connection that creates users automatically maps a required unique property but does not
 * verify it.
 *
 * @remarks
 * Why it matters: A claim with no verified_claims entry always arrives unverified, so the
 * automatic creation can never pass. It is only a warning because the project still deploys and
 * can sign people in.
 *
 * Reported once: A required unique property the connection does not map is named by
 * sso/impossible-auto-creation-data, or by sso/empty-claim-mapping when the mapping fills nothing,
 * so only a mapped one is judged here. A property that a mistyped verified_claims key most likely
 * meant is not reported, because that typo is already an error from sso/orphaned-verification-key.
 *
 * Fix: Add the property to verified_claims in the connection file, naming the claim that verifies
 * it.
 *
 * Origin: #3287 (Impossible Auto-Creation (Verification) of #1083);
 * docs/design/idp/1-resource-model.md#validator-rules.
 */
export const IMPOSSIBLE_AUTO_CREATION_VERIFICATION: Rule = defineRule({
  id: "sso/impossible-auto-creation-verification",
  severity: "warning",
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
