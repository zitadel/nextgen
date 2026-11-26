import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";
import { fits, standardClaim } from "@/lib/zitadel/rules/claims";
import { article, quote, standing } from "@/lib/zitadel/rules/sso/shared";

/**
 * A standard claim is mapped into a property whose declared type cannot hold it.
 *
 * @remarks
 * Why it matters: The value the provider sends does not fit the property, such as a number claim
 * like updated_at into a string or an object claim like address into a string, so it is rejected or
 * mangled. It is only a warning because the provider may send a different shape.
 *
 * Reported once: A property with no declared type, or a claim the standard does not define, is not
 * judged.
 *
 * Fix: Read a claim of a matching type, or change the type of the property.
 *
 * Origin: #2889; the warning-grade rules of #1083;
 * docs/design/idp/2-auth-method-selection.md#validation-rules as Claim Type Mismatch.
 */
export const CLAIM_TYPE_MISMATCH: Rule = defineRule({
  id: "sso/claim-type-mismatch",
  severity: "warning",
  each: (config) => {
    return standing(config).flatMap((entry) => {
      return entry.connection.mappings.flatMap((row) => {
        const standard = standardClaim(row.claim);
        if (standard === undefined || typeof row.claim !== "string") {
          return [];
        }
        const declared = entry.listing.flatMap((schema) => {
          const types = schema.findDeclaredTypes(row.property);
          if (types === undefined) {
            return [];
          }
          return [types];
        });
        return [
          {
            connection: entry.connection,
            property: row.property,
            claim: row.claim,
            standard,
            declared,
          },
        ];
      });
    });
  },
  when: (fact) => {
    return (
      fact.declared.length > 0 &&
      !fact.declared.some((types) => {
        return types.some((type) => {
          return fits(fact.standard.type, type);
        });
      })
    );
  },
  file: (fact) => {
    return fact.connection.path;
  },
  says: (fact) => {
    const declared = [...new Set(fact.declared.flat())];
    return `claim_mapping reads ${quote(fact.claim)}, ${article(fact.standard.type)} ${fact.standard.type} claim, into ${quote(fact.property)}, which the schema types as ${declared.join(" or ")}. Read a claim of a matching type, or change the type of ${quote(fact.property)}.`;
  },
});
