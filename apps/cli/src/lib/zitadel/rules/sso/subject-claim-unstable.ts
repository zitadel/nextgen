import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";
import { standardClaim } from "@/lib/zitadel/rules/claims";
import { quote, standing } from "@/lib/zitadel/rules/sso/shared";

/**
 * Names that are not standard claims but are, wherever they appear, an
 * account name a user can change.
 */
const MUTABLE_SUBJECTS: ReadonlySet<string> = new Set(["login", "username"]);

/**
 * The subject_claim of a connection is a profile claim or an account name that the user can change.
 *
 * @remarks
 * Why it matters: Identity keys on the subject, so if the value changes the user is signed in as a
 * stranger, or the next holder of the value inherits the account. It is only a warning because the
 * connection works until the value changes.
 *
 * Reported once: Only before the first deploy of the connection. The server keeps a connection's
 * subject once it has it, so the advice could not be followed after.
 *
 * Fix: Use a claim that never changes, such as sub, or a provider-specific one such as oid.
 *
 * Origin: #2889; the Mutable Subject Claim of #1083;
 * docs/design/idp/2-auth-method-selection.md#validation-rules and
 * 1-resource-model.md#validator-rules.
 */
export const SUBJECT_CLAIM_UNSTABLE: Rule = defineRule({
  id: "sso/subject-claim-unstable",
  severity: "warning",
  each: (config) => {
    return standing(config).flatMap((entry) => {
      const subject = entry.connection.subjectClaim;
      if (subject === undefined || config.connections.isDeployed(entry.slug)) {
        return [];
      }
      return [{ connection: entry.connection, subject }];
    });
  },
  when: (fact) => {
    return standardClaim(fact.subject) !== undefined || MUTABLE_SUBJECTS.has(fact.subject);
  },
  file: (fact) => {
    return fact.connection.path;
  },
  says: (fact) => {
    return `subject_claim is ${quote(fact.subject)}, a profile claim the user can change, and identity keys on the subject, so a change would sign them in as a stranger. Use a claim that never changes: "sub", or a provider-specific one such as "oid".`;
  },
});
