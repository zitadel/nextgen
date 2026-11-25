import { nameClient } from "@/lib/zitadel/rules/applications/shared";
import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";

/**
 * Two clients, in one application file or in two, declare the same
 * `client_id`.
 *
 * @remarks
 * Why it matters: A `client_id` names one client in the project, so the server
 * refuses the release (`app.invalid`) after the deploy has started.
 *
 * Reported once: Reported on each later client only, naming the client that
 * first declares the id. A missing `client_id` is the application contract's.
 *
 * Fix: Give each client its own `client_id`.
 *
 * Origin: #2790; the declared-application rules in
 * `apps/api/api/openapi/endpoints/releases/build/configuration-bundle.yaml`.
 */
export const DUPLICATE_CLIENT_ID: Rule = defineRule({
  id: "application/duplicate-client-id",
  severity: "error",
  each: (config) => {
    const uses = config.applications.all.flatMap((application) => {
      return application.value.clients.flatMap((client) => {
        if (client.client_id === undefined) {
          return [];
        }
        return [{ application, client: client.slug, clientId: client.client_id }];
      });
    });
    return uses.flatMap((use, index) => {
      const owner = uses.find((candidate) => {
        return candidate.clientId === use.clientId;
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
    return `client ${JSON.stringify(fact.use.client)} declares the client_id ${JSON.stringify(fact.use.clientId)}, which ${nameClient(fact.owner, fact.use.application)} also declares. A client_id names one client: give each client its own.`;
  },
});
