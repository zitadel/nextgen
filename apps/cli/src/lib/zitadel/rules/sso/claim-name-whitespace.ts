import type { ClaimRead } from "@/lib/zitadel/resources/connections/types";
import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";
import { claimReads, quote, standing } from "@/lib/zitadel/rules/sso/shared";

/**
 * A Unicode space at either end of a name.
 *
 * @remarks
 * The set Go's `strings.TrimSpace` trims, so both sides agree.
 */
const EDGE_SPACE = /^\p{White_Space}|\p{White_Space}$/u;

export const CLAIM_NAME_WHITESPACE: Rule = defineRule({
  id: "sso/claim-name-whitespace",
  severity: "error",
  // A claim name is matched exactly, so a space around it names a claim no
  // provider sends.
  each: (config) => {
    return standing(config).flatMap((entry) => {
      const subject = entry.connection.subjectClaim;
      const subjectReads: readonly ClaimRead[] =
        subject === undefined ? [] : [{ field: "subject_claim", claim: subject }];
      return [...claimReads(entry.connection), ...subjectReads].map((read) => {
        return { connection: entry.connection, ...read };
      });
    });
  },
  when: (fact) => {
    return EDGE_SPACE.test(fact.claim);
  },
  file: (fact) => {
    return fact.connection.path;
  },
  says: (fact) => {
    return `${fact.field} names ${quote(fact.claim)}, which has a space at its start or end, so no provider sends a claim by that name. Remove the space.`;
  },
});
