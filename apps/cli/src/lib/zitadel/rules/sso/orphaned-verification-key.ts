import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";
import { didYouMean } from "@/lib/zitadel/utils/spelling";
import { quote, readableProperties, standing, unreadable } from "@/lib/zitadel/rules/sso/shared";

/**
 * A verified_claims key names a property that no schema listing the connection defines.
 *
 * @remarks
 * Why it matters: The key can never verify anything, which usually means a mistyped property name.
 *
 * Reported once: Judged only for a connection some schema lists, since one no schema lists has
 * nothing to be judged against.
 *
 * Fix: Fix the property name, or remove the key.
 *
 * Origin: #1703 (Orphaned Verification Key, issue #1044); moved to the CLI by #2889;
 * docs/design/idp/1-resource-model.md#validator-rules.
 */
export const ORPHANED_VERIFICATION_KEY: Rule = defineRule({
  id: "sso/orphaned-verification-key",
  severity: "error",
  each: (config) => {
    return standing(config).flatMap((entry) => {
      return entry.connection.verifications.map((row) => {
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
    return `verified_claims key ${quote(fact.property)} is not a property of any schema that lists ${quote(fact.entry.slug)} in sso.providers, so it can never verify.${didYouMean(fact.property, readableProperties(fact.entry))} Fix the name, or remove it.`;
  },
});
