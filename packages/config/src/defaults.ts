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

export const DEFAULT_BUILTIN_SCHEMA_BASE = "https://nextgen.com/api/schemas";
export const DEFAULT_FLOW_SCHEMA_URI = "https://nextgen.com/flow-definition.json";
export const DEFAULT_SCHEMA_CONFIG_PATH = ".zitadel/schemas/default-human-user.json";
export const DEFAULT_FLOW_CONFIG_PATH = ".zitadel/flows/default-login.json";

export type DefaultConfigRenderOptions = {
  builtinSchemaBase?: string;
  userSchemaUrl?: string;
};

export function defaultHumanUserSchemaUrl(
  builtinSchemaBase = DEFAULT_BUILTIN_SCHEMA_BASE,
): string {
  return `${trimTrailingSlash(builtinSchemaBase)}/default-human-user.json`;
}

export function getDefaultHumanUserSchema(
  options: DefaultConfigRenderOptions = {},
): CreateSchemaBody {
  const builtinSchemaBase = trimTrailingSlash(
    options.builtinSchemaBase ?? DEFAULT_BUILTIN_SCHEMA_BASE,
  );
  return renderTemplate(defaultHumanUserSchemaTemplate, {
    SERVER_URL: builtinSchemaBase,
    USER_SCHEMA_URL: options.userSchemaUrl ?? defaultHumanUserSchemaUrl(builtinSchemaBase),
  }) as CreateSchemaBody;
}

export function getDefaultLoginFlow(
  options: DefaultConfigRenderOptions = {},
): CreateFlowDefinitionBodyFlowDefinition {
  const builtinSchemaBase = trimTrailingSlash(
    options.builtinSchemaBase ?? DEFAULT_BUILTIN_SCHEMA_BASE,
  );
  return renderTemplate(defaultLoginFlowTemplate, {
    SERVER_URL: builtinSchemaBase,
    USER_SCHEMA_URL: options.userSchemaUrl ?? defaultHumanUserSchemaUrl(builtinSchemaBase),
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
