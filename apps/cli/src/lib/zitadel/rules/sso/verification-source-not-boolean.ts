import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";
import { standardClaim } from "@/lib/zitadel/rules/claims";
import { article, quote, standing } from "@/lib/zitadel/rules/sso/shared";

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
