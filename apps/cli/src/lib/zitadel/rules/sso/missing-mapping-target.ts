import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";
import { quote, standing } from "@/lib/zitadel/rules/sso/shared";

export const MISSING_MAPPING_TARGET: Rule = defineRule({
  id: "sso/missing-mapping-target",
  severity: "warning",
  // A target no listing schema defines is the error sso/orphaned-mapping-target,
  // so it is not reported again here. A connection may map a superset of what
  // each schema defines, hence a warning and not an error.
  each: (config) => {
    return standing(config).flatMap((entry) => {
      return entry.connection.mappings.flatMap((row) => {
        const lacking = entry.listing.filter((schema) => {
          return !schema.has(row.property);
        });
        if (lacking.length === 0 || lacking.length === entry.listing.length) {
          return [];
        }
        return [{ entry, property: row.property, lacking }];
      });
    });
  },
  file: (fact) => {
    return fact.entry.connection.path;
  },
  says: (fact) => {
    const files = fact.lacking
      .map((schema) => {
        return schema.path;
      })
      .join(", ");
    return `claim_mapping target ${quote(fact.property)} is not a property of ${files}, which list ${quote(fact.entry.slug)} in sso.providers, so the claim is dropped for those users. Add the property to ${fact.lacking.length === 1 ? "that schema" : "those schemas"}, or remove the row if only the other schemas need it.`;
  },
});
