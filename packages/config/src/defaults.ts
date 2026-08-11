import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
import passkeyFirstHumanUserSchemaTemplate from "../defaults/presets/passkey-first/human-user.json" with {
  type: "json",
};
import passkeyFirstLoginFlowTemplate from "../defaults/presets/passkey-first/login.json" with {
  type: "json",
};

export { brandingReadmeContent, flowsReadmeContent, schemasReadmeContent } from "./readmes.js";

export const DEFAULT_BUILTIN_SCHEMA_BASE = "https://nextgen.com/api/schemas";
export const DEFAULT_FLOW_SCHEMA_URI = "https://nextgen.com/flow-definition.json";
export const DEFAULT_SCHEMA_CONFIG_PATH = ".zitadel/schemas/default-human-user.json";
export const DEFAULT_FLOW_CONFIG_PATH = ".zitadel/flows/default-login.json";
export const DEFAULT_BRANDING_CONFIG_PATH = ".zitadel/branding/branding.json";
export const DEFAULT_BRANDING_TEMPLATE_PATH = ".zitadel/branding/login.liquid";

/**
 * Named schema+flow bundles `zitadel setup` can scaffold (#448: the prompt
 * fires before any `.zitadel/` file is written; each preset maps to a
 * pre-defined bundle the CLI copies on first setup). `password-first` is
 * today's default; `passkey-first` puts a passkey ceremony on the login
 * entry step with an email→password fallback path.
 */
export const SETUP_PRESETS = ["password-first", "passkey-first"] as const;

export type SetupPreset = (typeof SETUP_PRESETS)[number];

export const DEFAULT_SETUP_PRESET: SetupPreset = "password-first";

const PRESET_TEMPLATES: Record<SetupPreset, { schema: unknown; flow: unknown }> = {
  "password-first": {
    schema: defaultHumanUserSchemaTemplate,
    flow: defaultLoginFlowTemplate,
  },
  "passkey-first": {
    schema: passkeyFirstHumanUserSchemaTemplate,
    flow: passkeyFirstLoginFlowTemplate,
  },
};

function presetTemplates(preset: string): { schema: unknown; flow: unknown } {
  // Own-property check: indexing a plain object with an arbitrary string
  // would let "__proto__"/"constructor" resolve via the prototype chain
  // and bypass the unknown-preset error.
  if (!Object.hasOwn(PRESET_TEMPLATES, preset)) {
    throw new Error(
      `unknown setup preset ${JSON.stringify(preset)} (known presets: ${SETUP_PRESETS.join(", ")})`,
    );
  }
  return PRESET_TEMPLATES[preset as SetupPreset];
}

/**
 * Login-design starting points `zitadel branding eject --design <name>` (and
 * `zitadel setup --design <name>`) scaffold into `.zitadel/branding/`. A
 * design is a full Liquid template plus the descriptor `layout` it degrades
 * to — the wire `layout` enum stays `centered | split`, richer designs are
 * delivered as templates (ADR 040).
 */
export const BRANDING_DESIGNS = ["centered", "split", "split-right", "hero", "minimal"] as const;

export type BrandingDesign = (typeof BRANDING_DESIGNS)[number];

export const DEFAULT_BRANDING_DESIGN: BrandingDesign = "centered";

/** Descriptor `layout` each design degrades to when its template is rejected. */
const DESIGN_LAYOUTS: Record<BrandingDesign, "centered" | "split"> = {
  centered: "centered",
  split: "split",
  "split-right": "split",
  hero: "split",
  minimal: "centered",
};

export type DefaultBrandingConfig = {
  /** The `.zitadel/branding/branding.json` descriptor body (sans `$schema`). */
  branding: {
    layout: "centered" | "split";
    liquid_template_file: string;
  };
  /** The `.zitadel/branding/login.liquid` template content. */
  template: string;
};

/**
 * Renders the scaffold files for a branding design. The `centered` template
 * is a drift-tested copy of the bundled default in `@zitadel/components`;
 * the other designs are authored variants of it.
 */
export function getDefaultBrandingConfig(
  design: string = DEFAULT_BRANDING_DESIGN,
): DefaultBrandingConfig {
  if (!Object.hasOwn(DESIGN_LAYOUTS, design)) {
    throw new Error(
      `unknown branding design ${JSON.stringify(design)} (known designs: ${BRANDING_DESIGNS.join(", ")})`,
    );
  }
  const known = design as BrandingDesign;
  return {
    branding: {
      layout: DESIGN_LAYOUTS[known],
      liquid_template_file: "./login.liquid",
    },
    template: readFileSync(packageFilePath(`../defaults/branding/${known}/login.liquid`), "utf8"),
  };
}

/**
 * Resolves a package-relative file to a real filesystem path. Vite-driven
 * runtimes (vitest in dependent packages) rewrite `import.meta.url` to a
 * `/@fs/...` URL, which `fileURLToPath` passes through verbatim — strip the
 * prefix so `readFileSync` gets an actual path.
 */
function packageFilePath(relative: string): string {
  const path = fileURLToPath(new URL(relative, import.meta.url));
  return path.startsWith("/@fs/") ? path.slice("/@fs".length) : path;
}

/**
 * The second setup axis (#448): *who* signs in, orthogonal to the sign-in
 * preset (*how* they sign in). The sign-in preset owns the flow shape and
 * auth methods; the use case owns which profile fields the schema collects.
 * Composing the two keeps us at one field catalog + one flow-per-preset
 * instead of a bundle per (use case × preset) pair. `minimal` is the
 * default and never blocks non-interactive runs.
 */
export const SETUP_USE_CASES = ["minimal", "consumer", "business"] as const;

export type SetupUseCase = (typeof SETUP_USE_CASES)[number];

export const DEFAULT_SETUP_USE_CASE: SetupUseCase = "minimal";

/**
 * Fields each use case collects, in register/display order. `email` is
 * always first and stays the only required property; the rest are optional
 * profile attributes gathered on the flow's register step. `givenName`/
 * `familyName` are the attributes the backend reads for a user's identity
 * (`internal/domain/user.go`); `companyName` is stored as a plain user
 * attribute today — there is no org/team model behind it yet.
 */
const USE_CASE_FIELDS: Record<SetupUseCase, readonly string[]> = {
  minimal: ["email"],
  consumer: ["email", "givenName", "familyName"],
  business: ["email", "givenName", "familyName", "companyName"],
};

/**
 * JSON-Schema bodies for the optional profile fields the CLI composes in per
 * use case. The shipped templates are an email-only baseline (shared verbatim
 * with the Go server fallback), so this catalog owns every field beyond
 * `email`. Authored in the templates' style — the backend maps identity by
 * attribute name, so `givenName`/`familyName` are the attributes it reads for
 * a user's identity (`internal/domain/user.go`).
 */
const EXTRA_FIELD_BODIES: Record<string, Record<string, unknown>> = {
  givenName: {
    type: "string",
    maxLength: 50,
    description: "The user's given (first) name.",
  },
  familyName: {
    type: "string",
    maxLength: 50,
    description: "The user's family (last) name.",
  },
  companyName: {
    type: "string",
    maxLength: 200,
    description: "The user's company name.",
  },
};

function useCaseFields(useCase: string): readonly string[] {
  // Own-property check, same rationale as presetTemplates: keep prototype
  // keys ("__proto__" etc.) from resolving to a real field list.
  if (!Object.hasOwn(USE_CASE_FIELDS, useCase)) {
    throw new Error(
      `unknown setup use case ${JSON.stringify(useCase)} (known use cases: ${SETUP_USE_CASES.join(", ")})`,
    );
  }
  return USE_CASE_FIELDS[useCase as SetupUseCase];
}

/**
 * The body for one use-case field: reuse the template's authored body when it
 * has one (so composed schemas match the shipped defaults for shared fields),
 * else the extra catalog, else a generic editable string so composition stays
 * total for any field a future use case introduces.
 */
function fieldBody(
  field: string,
  templateProps: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  if (Object.hasOwn(templateProps, field)) {
    return { ...templateProps[field] };
  }
  if (Object.hasOwn(EXTRA_FIELD_BODIES, field)) {
    return { ...EXTRA_FIELD_BODIES[field] };
  }
  return { type: "string", description: `The user's ${field}.` };
}

/**
 * Narrow a rendered schema to the chosen use case: keep the preset-owned
 * header and `x-auth-methods`, but replace `properties`/`required` with the
 * use case's field set. `email` is the sole required property.
 */
function applyUseCaseToSchema(
  schema: Record<string, unknown>,
  useCase: string,
): Record<string, unknown> {
  const templateProps = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const properties: Record<string, unknown> = {};
  for (const field of useCaseFields(useCase)) {
    properties[field] = fieldBody(field, templateProps);
  }
  return { ...schema, required: ["email"], properties };
}

/**
 * Derive the flow's register-step fields from the use case rather than
 * copying a hard-coded list into every bundle (#448): the register step
 * collects exactly what the schema defines. Other steps are untouched.
 */
function applyUseCaseToFlow(
  flow: Record<string, unknown>,
  useCase: string,
): Record<string, unknown> {
  const fields = [...useCaseFields(useCase)];
  const steps = (flow.steps as Array<Record<string, unknown>>).map((step) =>
    step.name === "register" ? { ...step, fields } : step,
  );
  return { ...flow, steps };
}

export type DefaultConfigRenderOptions = {
  builtinSchemaBase?: string;
  userSchemaUrl?: string;
  /** Which flow/auth bundle to render; defaults to {@link DEFAULT_SETUP_PRESET}. */
  preset?: string;
  /** Which field set to collect; defaults to {@link DEFAULT_SETUP_USE_CASE}. */
  useCase?: string;
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
  const rendered = renderTemplate(presetTemplates(options.preset ?? DEFAULT_SETUP_PRESET).schema, {
    SERVER_URL: builtinSchemaBase,
    USER_SCHEMA_URL: options.userSchemaUrl ?? defaultHumanUserSchemaUrl(builtinSchemaBase),
  }) as Record<string, unknown>;
  return applyUseCaseToSchema(
    rendered,
    options.useCase ?? DEFAULT_SETUP_USE_CASE,
  ) as CreateSchemaBody;
}

export function getDefaultLoginFlow(
  options: DefaultConfigRenderOptions = {},
): CreateFlowDefinitionBodyFlowDefinition {
  const builtinSchemaBase = trimTrailingSlash(
    options.builtinSchemaBase ?? DEFAULT_BUILTIN_SCHEMA_BASE,
  );
  const rendered = renderTemplate(presetTemplates(options.preset ?? DEFAULT_SETUP_PRESET).flow, {
    SERVER_URL: builtinSchemaBase,
    USER_SCHEMA_URL: options.userSchemaUrl ?? defaultHumanUserSchemaUrl(builtinSchemaBase),
  }) as Record<string, unknown>;
  return applyUseCaseToFlow(
    rendered,
    options.useCase ?? DEFAULT_SETUP_USE_CASE,
  ) as CreateFlowDefinitionBodyFlowDefinition;
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
  let trimmed = value;
  while (trimmed.endsWith("/")) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed;
}
