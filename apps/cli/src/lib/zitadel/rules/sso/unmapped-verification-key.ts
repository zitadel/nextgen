import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";
import { closest } from "@/lib/zitadel/utils/spelling";
import { quote, readableProperties, standing, unreadable } from "@/lib/zitadel/rules/sso/shared";

/**
 * A verified_claims key has no claim_mapping entry.
 *
 * @remarks
 * Why it matters: The claim that would verify the property is never read, so the property is never
 * verified.
 *
 * Reported once: A connection no schema lists and no flow offers is not in use, such as the file
 * auth-method sso disable keeps, so it is not judged. A key no schema defines is reported by
 * sso/orphaned-verification-key. A mapped name that is a typo of a verified key is reported by
 * sso/orphaned-mapping-target with a Did you mean naming that key, and the key then has no mapping
 * only because of the typo, so it is not reported again.
 *
 * Fix: Add the key to claim_mapping, or remove it from verified_claims.
 *
 * Origin: #1703 (Unmapped verification key, issue #1044, which the design docs did not list); moved
 * to the CLI by #2889; docs/design/idp/1-resource-model.md#validator-rules.
 */
export const UNMAPPED_VERIFICATION_KEY: Rule = defineRule({
  id: "sso/unmapped-verification-key",
  severity: "error",
  each: (config) => {
    return standing(config).flatMap((entry) => {
      const offered = config.flows.offers.some((offer) => {
        return offer.slug === entry.slug;
      });
      if (entry.listing.length === 0 && !offered) {
        return [];
      }
      const meant = entry.connection.mappings
        .filter((row) => {
          return unreadable(entry, row.property);
        })
        .map((row) => {
          return closest(row.property, readableProperties(entry));
        });
      return entry.connection.verifications.map((row) => {
        return { entry, property: row.property, meant };
      });
    });
  },
  when: (fact) => {
    return (
      !fact.entry.connection.maps(fact.property) &&
      !unreadable(fact.entry, fact.property) &&
      !fact.meant.includes(fact.property)
    );
  },
  file: (fact) => {
    return fact.entry.connection.path;
  },
  says: (fact) => {
    return `verified_claims key ${quote(fact.property)} has no claim_mapping entry, so the claim is never read. Add ${quote(fact.property)} to claim_mapping, or remove it from verified_claims.`;
  },
});
