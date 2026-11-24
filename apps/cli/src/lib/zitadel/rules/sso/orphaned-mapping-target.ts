import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";
import { didYouMean } from "@/lib/zitadel/utils/spelling";
import { quote, readableProperties, standing, unreadable } from "@/lib/zitadel/rules/sso/shared";

/**
 * A claim_mapping row maps into a property that no schema listing the connection defines.
 *
 * @remarks
 * Why it matters: The mapping is never read, which usually means a mistyped property name.
 *
 * Reported once: Judged only for a connection some schema lists, since one no schema lists has
 * nothing to be judged against. The message names the property it most likely meant, and what
 * follows from the typo is not reported again.
 *
 * Fix: Fix the property name, or remove the row.
 *
 * Origin: #1703 (Orphaned Mapping Target, issue #1044); moved to the CLI by #2889;
 * docs/design/idp/1-resource-model.md#validator-rules.
 */
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
    // Candidates for the typo: the schemas' properties not already mapped.
    const nameable = readableProperties(fact.entry).filter((name) => {
      return !fact.entry.connection.maps(name);
    });
    return `claim_mapping target ${quote(fact.property)} is not a property of any schema that lists ${quote(fact.entry.slug)} in sso.providers.${didYouMean(fact.property, nameable)} Fix the name, or remove the row.`;
  },
});
