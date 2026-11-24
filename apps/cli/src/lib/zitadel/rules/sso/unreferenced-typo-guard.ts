import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";
import { didYouMean } from "@/lib/zitadel/utils/spelling";
import { quote, standing } from "@/lib/zitadel/rules/sso/shared";

export const UNREFERENCED_TYPO_GUARD: Rule = defineRule({
  id: "sso/unreferenced-typo-guard",
  severity: "warning",
  // The orphaned-* errors judge a connection some schema lists. This judges
  // one none lists against every schema in the project instead. It stays
  // silent when a flow offers the connection: that is already refused at the
  // step by sso/provider-id, and listing it makes the orphaned-* errors
  // apply. It also stays silent when the project has no schema, or an
  // external one whose properties are not known, since nothing can then be
  // called unknown.
  each: (config) => {
    const schemas = config.schemas.all;
    if (
      schemas.length === 0 ||
      schemas.some((schema) => {
        return schema.isExternal;
      })
    ) {
      return [];
    }
    const known = schemas.flatMap((schema) => {
      return schema.propertyNames;
    });
    return standing(config).flatMap((entry) => {
      const offered = config.flows.offers.some((offer) => {
        return offer.slug === entry.slug;
      });
      if (entry.listing.length > 0 || offered) {
        return [];
      }
      const keys = [
        ...entry.connection.mappings.map((row) => {
          return { field: "claim_mapping target", property: row.property };
        }),
        ...entry.connection.verifications.map((row) => {
          return { field: "verified_claims key", property: row.property };
        }),
      ];
      return keys
        .filter((key) => {
          return !known.includes(key.property);
        })
        .map((key) => {
          return { entry, known, ...key };
        });
    });
  },
  file: (fact) => {
    return fact.entry.connection.path;
  },
  says: (fact) => {
    return `${fact.field} ${quote(fact.property)} is not a property of any schema in the project, so it looks mistyped.${didYouMean(fact.property, fact.known)} Fix the name, or remove it.`;
  },
});
