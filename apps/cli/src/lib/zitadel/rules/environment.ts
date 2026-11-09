/**
 * The rule that a deploy's environment holds every variable the files
 * reference. The server cannot check it: the references point at the
 * deployer's environment, and a placeholder that reaches the server is sent
 * literally and never resolved.
 */

import type { ConfigDocument } from "@/lib/zitadel/document";
import type { JsonObject } from "@/lib/zitadel/types";
import { environmentReferences } from "@/lib/zitadel/utils/environment";
import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";

/** The rules a deploy's environment is held to. */
export const ENVIRONMENT_RULES: readonly Rule[] = [
  defineRule({
    id: "environment/missing-variable",
    severity: "error",
    each: (config, context) => {
      const environment = context.environment;
      if (environment === undefined) {
        return [];
      }
      // Branding is judged as it is sent, with its template inlined, since a
      // template may reference a variable too.
      const judged: ReadonlyArray<Readonly<{ document: ConfigDocument; body: JsonObject }>> = [
        ...[...config.schemas, ...config.flows].map((document) => {
          return { document, body: document.body };
        }),
        ...config.brandings.map((document) => {
          return {
            document,
            body: context.store === undefined ? document.body : document.wireBody(context.store),
          };
        }),
      ];
      return judged.flatMap(({ document, body }) => {
        return environmentReferences(body)
          .filter((name) => {
            return !environment[name];
          })
          .map((name) => {
            return { document, name };
          });
      });
    },
    file: (fact) => {
      return fact.document.path;
    },
    says: (fact) => {
      return `references the environment variable ${fact.name}, which is not set`;
    },
  }),
];
