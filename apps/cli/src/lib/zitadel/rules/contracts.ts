/**
 * The rules each file is held to on its own: the contract the server enforces
 * for its kind, and what a file of that kind must never hold.
 *
 * The same rules decide what {@link ZitadelConfig.load} refuses, so a file
 * that loads is one that validates, and the other way round.
 */

import { isVariableReference, missingEndpoints } from "@zitadel/config/idp";
import {
  brandingConfigSchema,
  flowConfigSchema,
  idpConnectionConfigSchema,
  schemaConfigSchema,
} from "@zitadel/config/schemas";
import { validateLoginTemplate } from "@zitadel/config/template";
import type { ZodType } from "zod";

import type { ZitadelConfig } from "@/lib/zitadel/config";
import type { ConfigDocument } from "@/lib/zitadel/document";
import { ConfigError } from "@/lib/zitadel/errors";
import type { JsonObject } from "@/lib/zitadel/types";
import type { RuleId } from "@/lib/zitadel/rules/types";
import { isJsonObject, objectAt } from "@/lib/zitadel/utils/json";
import { defineRule, type Rule } from "@/lib/zitadel/rules/rule";

/** One thing a contract refuses in one file. */
type Refusal = Readonly<{ document: ConfigDocument; message: string }>;

/**
 * A body without the editor-only `$schema` pointer, which no contract has.
 *
 * @param body - A file's body.
 * @returns The body the contract judges.
 */
function judged(body: JsonObject): JsonObject {
  const { $schema: _editorOnly, ...rest } = body;
  return rest;
}

/**
 * What a contract refuses in each of some documents.
 *
 * @param documents - The documents.
 * @param contract - The contract they are held to.
 * @returns One refusal per issue.
 */
function refusals(documents: readonly ConfigDocument[], contract: ZodType): Refusal[] {
  return documents.flatMap((document) => {
    const result = contract.safeParse(judged(document.body));
    if (result.success) {
      return [];
    }
    return result.error.issues.map((issue) => {
      return { document, message: `${issue.path.join(".") || "(root)"} ${issue.message}` };
    });
  });
}

/**
 * The rule that holds one kind of file to its contract.
 *
 * @param id - The rule's id.
 * @param documents - The documents of that kind.
 * @param contract - The contract.
 * @returns The rule.
 */
function contractRule(
  id: RuleId,
  documents: (config: ZitadelConfig) => readonly ConfigDocument[],
  contract: ZodType,
): Rule {
  return defineRule({
    id,
    severity: "error",
    each: (config) => {
      return refusals(documents(config), contract);
    },
    file: (refusal) => {
      return refusal.document.path;
    },
    says: (refusal) => {
      return refusal.message;
    },
  });
}

/**
 * Whether a connection holds its secret as a value rather than a reference,
 * which would publish the credential.
 *
 * @param body - The connection's body.
 * @returns Whether it does.
 */
function holdsLiteralSecret(body: JsonObject): boolean {
  const secret = objectAt(body, "oidc").client_secret;
  return typeof secret === "string" && !isVariableReference(secret);
}

/** Whether a document's body is held by its contract without refusal. */
function conforms(body: JsonObject, contract: ZodType): boolean {
  return contract.safeParse(judged(body)).success;
}

/** The rules every file is held to on its own. */
export const CONTRACT_RULES: readonly Rule[] = [
  contractRule(
    "contract/schema",
    (config) => {
      return config.schemas;
    },
    schemaConfigSchema,
  ),

  contractRule(
    "contract/flow",
    (config) => {
      return config.flows;
    },
    flowConfigSchema,
  ),

  defineRule({
    id: "contract/connection",
    severity: "error",
    // A literal secret is its own rule, with what to do about it, so its
    // refusal is not repeated as a shape the contract does not take.
    each: (config) => {
      return refusals(config.connections, idpConnectionConfigSchema).filter((refusal) => {
        return !(
          holdsLiteralSecret(refusal.document.body) && refusal.message.includes("client_secret")
        );
      });
    },
    file: (refusal) => {
      return refusal.document.path;
    },
    says: (refusal) => {
      return refusal.message;
    },
  }),

  defineRule({
    id: "connection/literal-secret",
    severity: "error",
    each: (config) => {
      return config.connections;
    },
    when: (connection) => {
      return holdsLiteralSecret(connection.body);
    },
    file: (connection) => {
      return connection.path;
    },
    says: () => {
      return 'client_secret must reference a variable, not hold a value. Use "client_secret": "${{ NAME }}" and publish the value as that variable.';
    },
  }),

  defineRule({
    id: "connection/endpoints",
    severity: "error",
    // The server refuses an `oidc` block that names some endpoints but not
    // every one it needs; naming none reads them from discovery.
    each: (config) => {
      return config.connections.flatMap((connection) => {
        if (!conforms(connection.body, idpConnectionConfigSchema)) {
          return [];
        }
        const missing = missingEndpoints(connection.body.oidc);
        if (missing.length === 0) {
          return [];
        }
        return [{ connection, missing }];
      });
    },
    file: (fact) => {
      return fact.connection.path;
    },
    says: (fact) => {
      return `oidc names some endpoints but not ${fact.missing.join(", ")}. Name every endpoint (authorization_endpoint, jwks_uri, token_endpoint, and userinfo_endpoint unless id_token_mapping is true), or none to read them from the issuer's discovery document.`;
    },
  }),

  defineRule({
    id: "contract/policy",
    severity: "error",
    each: (config) => {
      return config.policies.flatMap((policy) => {
        return policy.problems.map((problem) => {
          return { policy, problem };
        });
      });
    },
    file: (fact) => {
      return fact.policy.path;
    },
    says: (fact) => {
      return fact.problem;
    },
  }),

  defineRule({
    id: "branding/legacy-template-key",
    severity: "error",
    each: (config) => {
      return config.brandings.flatMap((branding) => {
        try {
          branding.assertCurrentTemplateKey();
          return [];
        } catch (error) {
          if (!(error instanceof ConfigError)) {
            throw error;
          }
          return [{ branding, message: `${error.message}. ${error.hint ?? ""}`.trim() }];
        }
      });
    },
    file: (fact) => {
      return fact.branding.path;
    },
    says: (fact) => {
      return fact.message;
    },
  }),

  defineRule({
    id: "contract/branding",
    severity: "error",
    // The retired key gets its migration above, not the bare unknown-key
    // refusal the contract would give.
    each: (config) => {
      return refusals(
        config.brandings.filter((branding) => {
          return branding.body.liquid_template_file === undefined;
        }),
        brandingConfigSchema,
      );
    },
    file: (refusal) => {
      return refusal.document.path;
    },
    says: (refusal) => {
      return refusal.message;
    },
  }),

  defineRule({
    id: "branding/template-file",
    severity: "error",
    // A deploy leaves an unreadable reference out of what it sends, so this
    // is the only place it can still be caught.
    each: (config, context) => {
      const store = context.store;
      if (store === undefined) {
        return [];
      }
      return config.brandings.flatMap((branding) => {
        try {
          branding.template(store);
          return [];
        } catch (error) {
          if (!(error instanceof ConfigError)) {
            throw error;
          }
          return [{ branding, message: error.message }];
        }
      });
    },
    file: (fact) => {
      return fact.branding.path;
    },
    says: (fact) => {
      return fact.message;
    },
  }),

  defineRule({
    id: "branding/template",
    severity: "error",
    // The same template rules the server applies, so a dry run, which makes no
    // server call, still catches a template the release would refuse.
    each: (config, context) => {
      const store = context.store;
      if (store === undefined) {
        return [];
      }
      return config.brandings.flatMap((branding) => {
        const template = templateOf(branding.body, () => {
          return branding.template(store);
        });
        if (template === undefined) {
          return [];
        }
        return validateLoginTemplate(template)
          .filter((issue) => {
            return issue.severity === "error";
          })
          .map((issue) => {
            return { branding, message: `template ${issue.rule}: ${issue.message}` };
          });
      });
    },
    file: (fact) => {
      return fact.branding.path;
    },
    says: (fact) => {
      return fact.message;
    },
  }),
];

/**
 * A descriptor's template, or `undefined` when it has none or it cannot be
 * read, which {@link CONTRACT_RULES}' template-file rule reports.
 *
 * @param body - The descriptor.
 * @param read - How the template is read.
 * @returns The template.
 */
function templateOf(body: JsonObject, read: () => string | undefined): string | undefined {
  if (!isJsonObject(body) || body.liquid_template_file !== undefined) {
    return undefined;
  }
  try {
    return read();
  } catch (error) {
    if (error instanceof ConfigError) {
      return undefined;
    }
    throw error;
  }
}
