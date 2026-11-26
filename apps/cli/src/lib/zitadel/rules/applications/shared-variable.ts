import { nameClient } from "@/lib/zitadel/rules/applications/shared";
import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";

/**
 * A client names as its secret a project variable that another client, in one
 * application file or in two, also names as its secret, or that a connection
 * names as its `client_id` or `client_secret`.
 *
 * @remarks
 * Why it matters: A variable stays the client's that first named it, so the
 * server refuses the release (`app.invalid`) rather than hand one client
 * another's secret. A connection's variable holds the credential an upstream
 * provider issued: the server does not refuse a client naming it, and the
 * client would then authenticate with that credential.
 *
 * Reported once: Reported on the client only. Against another client, on each
 * later one, naming the client that first names the variable; against a
 * connection, naming the connection's file and field. A secret held as a value
 * is the application contract's.
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
    const credentials = config.connections.all.flatMap((connection) => {
      const held = connection.credentials;
      if (held === undefined) {
        return [];
      }
      return [held.clientId, held.clientSecret].flatMap((credential) => {
        if (credential.kind === "literal") {
          return [];
        }
        return [{ connection, field: credential.field, variable: credential.variable }];
      });
    });
    return uses.flatMap((use, index) => {
      const credential = credentials.find((candidate) => {
        return candidate.variable === use.variable;
      });
      if (credential !== undefined) {
        return [
          {
            use,
            owner: `${credential.connection.path} also uses as its ${credential.field}`,
          },
        ];
      }
      const owner = uses.find((candidate) => {
        return candidate.variable === use.variable;
      });
      if (owner === undefined || uses.indexOf(owner) === index) {
        return [];
      }
      return [{ use, owner: `${nameClient(owner, use.application)} also names` }];
    });
  },
  file: (fact) => {
    return fact.use.application.path;
  },
  says: (fact) => {
    return `client ${JSON.stringify(fact.use.client)} names the secret variable ${fact.use.variable}, which ${fact.owner}. Give each client its own secret variable.`;
  },
});
