import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";
import { didYouMean } from "@/lib/zitadel/utils/spelling";
import { quote, readableProperties, standing, unreadable } from "@/lib/zitadel/rules/sso/shared";

export const ORPHANED_MAPPING_TARGET: Rule = defineRule({
  id: "sso/orphaned-mapping-target",
  severity: "error",
  each: (config) => {
    return standing(config).flatMap((entry) => {
      return entry.connection.mappings.map((row) => {
        return { entry, property: row.property };
      });
    });
  },
  when: (fact) => {
    return unreadable(fact.entry, fact.property);
  },
  file: (fact) => {
    return fact.entry.connection.path;
  },
  says: (fact) => {
    // What a mistyped name could have meant: the properties of the schemas
    // that list this connection, less the ones already mapped.
    const nameable = readableProperties(fact.entry).filter((name) => {
      return !fact.entry.connection.maps(name);
    });
    return `claim_mapping target ${quote(fact.property)} is not a property of any schema that lists ${quote(fact.entry.slug)} in sso.providers.${didYouMean(fact.property, nameable)} Fix the name, or remove the row.`;
  },
});
