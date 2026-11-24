import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";
import { isStandardScope, standardClaim } from "@/lib/zitadel/rules/claims";
import { claimReads, quote, standing } from "@/lib/zitadel/rules/sso/shared";

/**
 * A claim_mapping or verified_claims row reads a standard claim without the scope that makes a
 * provider return it.
 *
 * @remarks
 * Why it matters: The provider does not send the claim, so the property is never filled or
 * verified. It is only a warning because a provider may return the claim another way, such as the
 * claims request parameter or its own behaviour, for a catalog connection as for a custom one.
 *
 * Reported once: Judged only when oidc.scopes holds standard scopes alone, because a scope the
 * standard does not define may bundle claims. One finding for each field and each missing scope.
 *
 * Fix: Add the scope to oidc.scopes, or read another claim.
 *
 * Origin: #2889; the warning-grade rules of #1083;
 * docs/design/idp/2-auth-method-selection.md#validation-rules as Claim Needs Scope.
 */
export const CLAIM_NEEDS_SCOPE: Rule = defineRule({
  id: "sso/claim-needs-scope",
  severity: "warning",
  each: (config) => {
    return standing(config).flatMap((entry) => {
      const scopes = entry.connection.scopes;
      if (scopes === undefined || !scopes.every(isStandardScope)) {
        return [];
      }
      const missing = claimReads(entry.connection).flatMap((read) => {
        const scope = standardClaim(read.claim)?.scope;
        if (scope === undefined || scopes.includes(scope)) {
          return [];
        }
        return [{ ...read, scope }];
      });
      const groups = [
        ...new Set(
          missing.map((read) => {
            return JSON.stringify([read.field, read.scope]);
          }),
        ),
      ];
      return groups.flatMap((key) => {
        const members = missing.filter((read) => {
          return JSON.stringify([read.field, read.scope]) === key;
        });
        const first = members[0];
        if (first === undefined) {
          return [];
        }
        const claims = [
          ...new Set(
            members.map((read) => {
              return read.claim;
            }),
          ),
        ];
        return [
          {
            connection: entry.connection,
            scopes,
            field: first.field,
            scope: first.scope,
            claims,
          },
        ];
      });
    });
  },
  file: (fact) => {
    return fact.connection.path;
  },
  says: (fact) => {
    return `${fact.field} reads ${fact.claims.map(quote).join(", ")}, which a provider only returns for the ${quote(fact.scope)} scope, and oidc.scopes is ${fact.scopes.map(quote).join(", ")}. Add ${quote(fact.scope)} to oidc.scopes, or read another claim.`;
  },
});
