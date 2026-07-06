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

export const DEFAULT_FLOW_SCHEMA_URI = "https://nextgen.com/flow-definition.json";
export const DEFAULT_SCHEMA_CONFIG_PATH = ".zitadel/schemas/default-human-user.json";
export const DEFAULT_FLOW_CONFIG_PATH = ".zitadel/flows/default-login.json";

/**
 * Return the default human-user schema template unchanged. The template's
 * `metaSchema` is the canonical builtin URI the server publishes and validates
 * against; the developer never edits it.
 */
export function getDefaultHumanUserSchema(): CreateSchemaBody {
  return structuredClone(defaultHumanUserSchemaTemplate) as CreateSchemaBody;
}

/**
 * Render the default login flow template with the schema reference the
 * developer wants to pin the flow to. The `ref` is whatever the server
 * accepts in the flow's `user_schema` field to look the schema up: today
 * that's the opaque id `POST /schemas` returns (e.g. `sch_01K…`); a
 * developer who chose their own `$id` on create can pass that URL instead.
 * There is no fallback — a flow written without a real ref would not
 * resolve at runtime.
 */
export function getDefaultLoginFlow(options: {
  userSchemaRef: string;
}): CreateFlowDefinitionBodyFlowDefinition {
  return renderTemplate(defaultLoginFlowTemplate, {
    USER_SCHEMA_URL: options.userSchemaRef,
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
