import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";

export const SHARED_VARIABLE: Rule = defineRule({
  id: "sso/shared-variable",
  severity: "error",
  each: (config) => {
    const uses = config.connections.all.flatMap((connection) => {
      const credentials = connection.credentials;
      if (credentials === undefined) {
        return [];
      }
      return [credentials.clientId, credentials.clientSecret].flatMap((credential) => {
        if (credential.kind === "literal") {
          return [];
        }
        return [{ connection, field: credential.field, variable: credential.variable }];
      });
    });
    return uses.flatMap((use) => {
      const owner = uses.find((candidate) => {
        return candidate.variable === use.variable;
      });
      if (owner === undefined) {
        return [];
      }
      return [{ use, owner }];
    });
  },
  when: (fact) => {
    return fact.owner.connection !== fact.use.connection;
  },
  file: (fact) => {
    return fact.use.connection.path;
  },
  says: (fact) => {
    return `${fact.use.field} names the variable ${fact.use.variable}, which ${fact.owner.connection.path} also uses (as its ${fact.owner.field}). Give each connection its own variable so one cannot overwrite the other.`;
  },
});
