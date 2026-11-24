import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";
import { standardClaim } from "@/lib/zitadel/rules/claims";
import { quote, standing } from "@/lib/zitadel/rules/sso/shared";

/**
 * Names that are not standard claims but are, wherever they appear, an
 * account name a user can change.
 */
const MUTABLE_SUBJECTS: ReadonlySet<string> = new Set(["login", "username"]);

export const SUBJECT_CLAIM_UNSTABLE: Rule = defineRule({
  id: "sso/subject-claim-unstable",
  severity: "warning",
  // Identity keys on the subject, so it has to be a value that never
  // changes. Only before the first deploy: the server keeps a connection's
  // subject once it has it, so the advice could not be followed after.
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
