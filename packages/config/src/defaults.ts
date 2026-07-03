import type {
  CreateFlowDefinitionBodyFlowDefinition,
  CreateSchemaBody,
} from "@zitadel/api/generated/model";

import defaultHumanUserSchemaTemplate from "../defaults/default-human-user.json" with {
  type: "json",
};
import defaultLoginFlowTemplate from "../defaults/default-login.json" with {
  type: "json",
};

export { flowsReadmeContent, schemasReadmeContent } from "./readmes.js";

export const DEFAULT_BUILTIN_SCHEMA_BASE = "https://nextgen.com/api/schemas";
export const DEFAULT_FLOW_SCHEMA_URI = "https://nextgen.com/flow-definition.json";
export const DEFAULT_SCHEMA_CONFIG_PATH = ".zitadel/schemas/default-human-user.json";
export const DEFAULT_FLOW_CONFIG_PATH = ".zitadel/flows/default-login.json";

export type BuiltinBaseOption = {
  builtinSchemaBase?: string;
};

/**
 * Compose the URL a flow definition's `user_schema` should point at for a
 * schema with server-assigned id `schemaId`. `apply` and setup use this after
 * `POST /schemas` returns; consumers of the resolved URL never need to know
 * the base separately.
 */
export function resolveSchemaUrl(
  schemaId: string,
  builtinSchemaBase: string = DEFAULT_BUILTIN_SCHEMA_BASE,
): string {
  return `${trimTrailingSlash(builtinSchemaBase)}/${schemaId}`;
}

/**
 * Render the default human-user schema template. The template carries no `$id`
 * — the server allocates one per revision — so this function only needs the
 * server base to substitute `${SERVER_URL}` in `metaSchema`.
 */
export function getDefaultHumanUserSchema(
  options: BuiltinBaseOption = {},
): CreateSchemaBody {
  const builtinSchemaBase = trimTrailingSlash(
    options.builtinSchemaBase ?? DEFAULT_BUILTIN_SCHEMA_BASE,
  );
  return renderTemplate(defaultHumanUserSchemaTemplate, {
    SERVER_URL: builtinSchemaBase,
  }) as CreateSchemaBody;
}

/**
 * Render the default login flow template with an explicit resolved
 * `user_schema` URL. The URL must be produced by the caller — typically by
 * feeding the id returned from `POST /schemas` into {@link resolveSchemaUrl}.
 * There is no fallback: a flow written without a real, server-assigned URL
 * would not resolve at runtime.
 */
export function getDefaultLoginFlow(options: {
  userSchemaUrl: string;
}): CreateFlowDefinitionBodyFlowDefinition {
  return renderTemplate(defaultLoginFlowTemplate, {
    USER_SCHEMA_URL: options.userSchemaUrl,
  }) as CreateFlowDefinitionBodyFlowDefinition;
}

function renderTemplate(value: unknown, replacements: Record<string, string>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => renderTemplate(item, replacements));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, renderTemplate(item, replacements)]),
    );
  }
  if (typeof value === "string") {
    return value.replaceAll(/\$\{([A-Z_]+)\}/g, (match, name: string) => {
      return replacements[name] ?? match;
    });
  }
  return value;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}
