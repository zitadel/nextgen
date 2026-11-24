import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";
import { didYouMean } from "@/lib/zitadel/utils/spelling";
import { quote, standing } from "@/lib/zitadel/rules/sso/shared";

/**
 * A claim_mapping target or verified_claims key of a connection no schema lists is a property no
 * schema in the project defines, so it looks mistyped.
 *
 * @remarks
 * Why it matters: With no schema listing the connection, the orphaned mapping and verification
 * errors have nothing to judge it against, so a typo would be read by nothing. It is only a
 * warning because the schema that lists the connection may not exist yet.
 *
 * Reported once: Judged against every schema in the project. A connection a flow offers is not
 * judged, because sso/provider-id already refuses that step and listing the connection makes the
 * orphaned errors apply. A project with no schema, or with an external one whose properties are
 * not known, is not judged, since nothing can then be called unknown. The message names the
 * property it most likely meant.
 *
 * Fix: Fix the name, or remove it.
 *
 * Origin: #3287 (Unreferenced Typo Guard of #1083);
 * docs/design/idp/1-resource-model.md#validator-rules.
 */
export const UNREFERENCED_TYPO_GUARD: Rule = defineRule({
  id: "sso/unreferenced-typo-guard",
  severity: "warning",
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
