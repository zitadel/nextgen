/**
 * The rule that a deploy's environment holds every variable the files
 * reference. The server cannot check it: the references point at the
 * deployer's environment, and a placeholder that reaches the server is sent
 * literally and never resolved.
 */

import type { ConfigDocument } from "@/lib/zitadel/resources/document";
import type { JsonObject } from "@/lib/zitadel/types";
import { environmentReferences } from "@/lib/zitadel/utils/environment";
import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";

/**
 * A document and the body its variables are read from.
 */
type JudgedDocument = {
  readonly document: ConfigDocument;
  readonly body: JsonObject;
};

/**
 * The rules a deploy's environment is held to.
 */
export const ENVIRONMENT_RULES: readonly Rule[] = [
  defineRule({
    id: "environment/missing-variable",
    severity: "error",
    each: (config, context) => {
      const environment = context.environment;
      const store = context.store;
      if (environment === undefined) {
        return [];
      }
      const asWritten = [...config.schemas.all, ...config.flows.all].map(
        (document): JudgedDocument => {
          return { document, body: document.body };
        },
      );
      // Branding is judged as it is sent, with its template inlined, since a
      // template may reference a variable too.
      const asSent = config.branding.all.map((document): JudgedDocument => {
        if (store === undefined) {
          return { document, body: document.body };
        }
        return { document, body: document.toWireBody(store) };
      });
      return [...asWritten, ...asSent].flatMap((judged) => {
        const unset = environmentReferences(judged.body).filter((name) => {
          const value = environment[name];
          return value === undefined || value === "";
        });
        return unset.map((name) => {
          return { document: judged.document, name };
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
