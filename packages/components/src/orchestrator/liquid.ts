/**
 * LiquidJS engine factory for the `<zitadel-login>` orchestrator.
 *
 * Configures the engine per the security pipeline in
 * `docs/design/flowengine/template-security.md` and registers the
 * `| t` filter and `{% field_patcher %}` tag from
 * `docs/design/branding/templates.md`.
 *
 * Hard rules:
 *
 * - `{{ }}` output is HTML-escaped (LiquidJS default since v10).
 * - The `| raw` filter is overridden to a no-op string passthrough that still
 *   escapes (Layer 1 of the security pipeline).
 * - Partials are loaded from an in-memory map; no filesystem access.
 */
import { Liquid } from "liquidjs";

import type { Locale } from "./locales/en.js";
import { fieldsPartial, registerFieldSupport } from "./liquid-fields.js";
import { fieldPatcherMarkerComment } from "./field-patcher.js";
import defaultTemplate from "./templates/default.liquid";

export const TEMPLATE_NAMES = {
  default: "default",
} as const;

export type CreateLiquidOptions = {
  locale: Locale;
  /**
   * Additional in-memory templates merged on top of the bundled defaults.
   * Useful for tests and for tenant-supplied `branding.liquid_template`
   * (registered under {@link TEMPLATE_NAMES.default}).
   */
  templates?: Record<string, string>;
};

export function createLiquidEngine(options: CreateLiquidOptions): Liquid {
  const templates: Record<string, string> = {
    [TEMPLATE_NAMES.default]: defaultTemplate,
    _fields: fieldsPartial,
    ...(options.templates ?? {}),
  };

  const engine = new Liquid({
    templates,
    cache: true,
    jsTruthy: true,
    relativeReference: false,
    strictFilters: false,
    strictVariables: false,
    outputEscape: "escape",
  });

  // Layer 1.5 — drop the `| raw` filter. We return a plain string instead of
  // the engine's "safe" marker, so the configured `outputEscape: "escape"`
  // still applies. Templates that historically used `| raw` therefore no
  // longer bypass auto-escaping.
  engine.registerFilter("raw", (value: unknown) => stringify(value));

  // The i18n filter. Looks up `text_key` in the active locale dictionary.
  // Extra args become positional `{n}` substitutions:
  //
  //   {{ "password.title" | t: identity.display_name }}
  //   -> "Welcome back, Alice"
  engine.registerFilter(
    "t",
    function tFilter(this: { context: unknown }, key: unknown, ...args: unknown[]) {
      const lookupKey = stringify(key);
      const template = options.locale[lookupKey] ?? lookupKey;
      return interpolate(template, args.map(stringify));
    },
  );

  /** Resolves `{text_key}.title` for form-level `<zl-alert heading>`. */
  engine.registerFilter("alertHeading", (textKey: unknown) => {
    const lookupKey = `${stringify(textKey)}.title`;
    return options.locale[lookupKey] ?? "";
  });

  /** Resolves `{text_key}.body` for form-level `<zl-alert>` message slot. */
  engine.registerFilter("alertBody", (textKey: unknown) => {
    const lookupKey = `${stringify(textKey)}.body`;
    return options.locale[lookupKey] ?? "";
  });

  // `{% field_patcher %}` — emits a unique marker comment that the
  // orchestrator post-processes via `patchFields`.
  engine.registerTag("field_patcher", {
    parse() {
      // No body, no args — nothing to consume.
    },
    render() {
      return fieldPatcherMarkerComment;
    },
  });

  // Field rendering: filters (fieldPlaceholder, fieldHelp, fieldError,
  // selectOptions, formLevelError) and the `{% fields %}` tag.
  registerFieldSupport(engine, options);

  return engine;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function stringify(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function interpolate(template: string, args: readonly string[]): string {
  if (args.length === 0) return template;
  return template.replace(/\{(\d+)\}/g, (match, index) => {
    const i = Number(index);
    return args[i] ?? match;
  });
}
