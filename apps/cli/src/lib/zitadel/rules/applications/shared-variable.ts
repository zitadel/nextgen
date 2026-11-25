import { nameClient } from "@/lib/zitadel/rules/applications/shared";
import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";

/**
 * Two clients, in one application file or in two, name the same project
 * variable as their secret.
 *
 * @remarks
 * Why it matters: A variable stays the client's that first named it, so the
 * server refuses the release (`app.invalid`) rather than hand one client
 * another's secret.
 *
 * Reported once: Reported on each later client only, naming the client that
 * first names the variable. A secret held as a value is the application
 * contract's.
 *
 * Fix: Give each client its own secret variable.
 *
 * Origin: #2790; the declared-application rules in
 * `apps/api/api/openapi/endpoints/releases/build/configuration-bundle.yaml`.
 */
export const SHARED_VARIABLE: Rule = defineRule({
  id: "application/shared-variable",
  severity: "error",
  each: (config) => {
    const uses = config.applications.all.flatMap((application) => {
      return application.secretVariables.map((secret) => {
        return { application, client: secret.client, variable: secret.variable };
      });
    });
    return uses.flatMap((use, index) => {
      const owner = uses.find((candidate) => {
        return candidate.variable === use.variable;
      });
      if (owner === undefined || uses.indexOf(owner) === index) {
        return [];
      }
      return [{ use, owner }];
    });
  },
  file: (fact) => {
    return fact.use.application.path;
  },
  says: (fact) => {
    return `client ${JSON.stringify(fact.use.client)} names the secret variable ${fact.use.variable}, which ${nameClient(fact.owner, fact.use.application)} also names. A variable holds one client's secret: give each client its own.`;
  },
});
