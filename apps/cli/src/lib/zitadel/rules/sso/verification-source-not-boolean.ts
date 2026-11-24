import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";
import { standardClaim } from "@/lib/zitadel/rules/claims";
import { article, quote, standing } from "@/lib/zitadel/rules/sso/shared";

/**
 * A verified_claims row reads a standard claim that is not a boolean to decide whether a property
 * is verified.
 *
 * @remarks
 * Why it matters: A claim that does not say whether a value is verified can never be true, so the
 * property never verifies. It is only a warning because the connection still works without
 * verification.
 *
 * Fix: Read the claim the provider sends for verification, such as email_verified.
 *
 * Origin: #2889; the warning-grade rules of #1083;
 * docs/design/idp/2-auth-method-selection.md#validation-rules as Verification Source Not Boolean.
 */
export const VERIFICATION_SOURCE_NOT_BOOLEAN: Rule = defineRule({
  id: "sso/verification-source-not-boolean",
  severity: "warning",
  each: (config) => {
    return standing(config).flatMap((entry) => {
      return entry.connection.verifications.flatMap((row) => {
        const standard = standardClaim(row.claim);
        if (standard === undefined || typeof row.claim !== "string") {
          return [];
        }
        return [
          {
            connection: entry.connection,
            property: row.property,
            claim: row.claim,
            type: standard.type,
          },
        ];
      });
    });
  },
  when: (fact) => {
    return fact.type !== "boolean";
  },
  file: (fact) => {
    return fact.connection.path;
  },
  says: (fact) => {
    return `verified_claims reads ${quote(fact.claim)} to verify ${quote(fact.property)}, but that is ${article(fact.type)} ${fact.type} claim, not one that says whether a value is verified, so it never verifies. Read the claim the provider sends for that (such as "email_verified").`;
  },
});
