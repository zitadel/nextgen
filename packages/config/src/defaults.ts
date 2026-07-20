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
 * delivered as templates (ADR 035).
 */
export const BRANDING_DESIGNS = ["centered", "split", "split-right", "minimal"] as const;

export type BrandingDesign = (typeof BRANDING_DESIGNS)[number];

export const DEFAULT_BRANDING_DESIGN: BrandingDesign = "centered";

/** Descriptor `layout` each design degrades to when its template is rejected. */
const DESIGN_LAYOUTS: Record<BrandingDesign, "centered" | "split"> = {
  centered: "centered",
  split: "split",
  "split-right": "split",
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

export type DefaultConfigRenderOptions = {
  builtinSchemaBase?: string;
  userSchemaUrl?: string;
  /** Which bundle to render; defaults to {@link DEFAULT_SETUP_PRESET}. */
  preset?: string;
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
  return renderTemplate(presetTemplates(options.preset ?? DEFAULT_SETUP_PRESET).schema, {
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
  return renderTemplate(presetTemplates(options.preset ?? DEFAULT_SETUP_PRESET).flow, {
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
