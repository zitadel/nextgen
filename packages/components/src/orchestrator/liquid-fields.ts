/**
 * Field rendering system for the LiquidJS template engine.
 *
 * Registers the `{% fields %}` tag and all field-related filters
 * (`fieldPlaceholder`, `fieldHelp`, `fieldError`, `selectOptions`,
 * `formLevelError`) on a given engine instance.
 *
 * The `{% fields %}` tag renders every field atom for the current step by
 * delegating to the `_fields` partial. Template authors just write
 * `{% fields %}` — the tag is a self-contained placeholder that works in any
 * template (server-embedded, client fallback, or tenant-custom).
 */
import type { Context, Liquid } from "liquidjs";

import type { FlowError } from "./template-context.js";
import fieldsPartial from "./templates/_fields.liquid";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export { fieldsPartial };

export type FieldsOptions = {
  locale: Record<string, string>;
};

/**
 * Register all field-related filters and the `{% fields %}` tag on `engine`.
 * Must be called after the engine is created so the `_fields` partial is
 * already in the in-memory template map.
 */
export function registerFieldSupport(engine: Liquid, options: FieldsOptions): void {
  /** Resolves `{text_key}.placeholder` — empty when undefined (not the raw key). */
  engine.registerFilter("fieldPlaceholder", (textKey: unknown) => {
    const lookupKey = `${stringify(textKey)}.placeholder`;
    return options.locale[lookupKey] ?? "";
  });

  /** Resolves `{text_key}.help` — empty when undefined. */
  engine.registerFilter("fieldHelp", (textKey: unknown) => {
    const lookupKey = `${stringify(textKey)}.help`;
    return options.locale[lookupKey] ?? "";
  });

  /**
   * Builds a JSON attribute string for `<zl-select>` from a field's closed
   * `validation.enum`. Returns a pre-serialized JSON string with single-quotes
   * escaped for safe embedding in a single-quoted HTML attribute.
   *
   * Marked `raw: true` so LiquidJS doesn't HTML-escape the JSON structure.
   * This is safe because the values come from the API schema enum, not user
   * HTML content.
   *
   * Usage: `options='{{ f.validation.enum | selectOptions }}'`
   */
  engine.registerFilter("selectOptions", {
    handler: (values: unknown) => {
      if (!Array.isArray(values)) return "[]";
      const opts = values.map((value) => {
        const v = stringify(value);
        return { value: v, label: v };
      });
      return JSON.stringify(opts).replace(/'/g, "&#39;");
    },
    raw: true,
  } as unknown as (values: unknown) => string);

  /** Localized inline error for `fieldName`, or empty when none applies. */
  engine.registerFilter("fieldError", (fieldName: unknown, errors: unknown) => {
    const name = stringify(fieldName);
    return resolveFieldError(name, errors, options.locale);
  });

  /** True when the error should render as `<zl-alert>`, not on a field. */
  engine.registerFilter("formLevelError", (err: unknown) => {
    const key = (err as FlowError)?.text_key ?? "";
    return key === "" || !(key in FIELD_ERROR_KEYS);
  });

  // `{% fields %}` — renders every field atom for the current step.
  // Internally delegates to the `_fields` partial (which lives in the
  // engine's in-memory template map), so all rendering logic stays in
  // Liquid and template authors just write `{% fields %}`.
  const fieldsTpl = engine.parseFileSync("_fields");
  engine.registerTag("fields", {
    parse() {
      // No args — reads `fields` from the current context.
    },
    render(ctx: Context) {
      return engine.renderSync(fieldsTpl, ctx);
    },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Maps `error.*` text keys to a field name (Figma inline-error annotations). */
const FIELD_ERROR_KEYS: Record<string, string> = {
  "error.email_required": "email",
  "error.email_invalid": "email",
  "error.email_exists": "email",
  "error.password_required": "password",
  "error.password_incorrect": "password",
  "error.invalid_credentials": "password",
};

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

/** Resolve a field-level inline error from the step error list. */
function resolveFieldError(
  name: string,
  errors: unknown,
  locale: Record<string, string>,
): string {
  if (!Array.isArray(errors)) return "";
  for (const item of errors) {
    const err = item as FlowError;
    const key = err.text_key ?? "";
    if (FIELD_ERROR_KEYS[key] === name) {
      return locale[key] ?? key;
    }
  }
  return "";
}
