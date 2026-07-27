/**
 * LiquidJS engine factory for the `<zitadel-login>` orchestrator.
 *
 * Configures the engine per the security pipeline in
 * `docs/design/flowengine/template-security.md` and registers the
 * `| t` filter and `{% mandatory_gates %}` tag from
 * `docs/design/branding/templates.md`.
 *
 * Hard rules:
 *
 * - `{{ }}` output is HTML-escaped (LiquidJS default since v10).
 * - The `| raw` filter is overridden to a no-op string passthrough that still
 *   escapes (Layer 1 of the security pipeline).
 * - Partials are loaded from an in-memory map; no filesystem access.
 */
import { MANDATORY_GATES_TAG } from "@zitadel/config/template";
import { Liquid } from "liquidjs";

import type { FlowError } from "./template-context.js";
import type { Locale } from "./locales/en.js";
import { hookName } from "../internal/hook-name.js";
import { mandatoryGatesMarkerComment } from "./mandatory-gates.js";
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

/**
 * Maps catalog `error.*` keys with no `_<rule>` suffix (so
 * {@link localiseFlowErrorKeys} can't derive the field from the key itself)
 * to their field name — the credential errors with bespoke catalog copy
 * (`error.email_exists`, `error.invalid_credentials`, …). Rule-suffixed keys
 * (`error.<field>_<rule>`) derive their field from the key. Consumed only by
 * {@link localiseFlowErrorKeys}, which stamps the resolved `field` onto the
 * error; the template filters (`fieldError` / `formLevelError`) then route by
 * that `field`, and an error whose field the step omits is downgraded to a
 * fieldless banner message.
 */
const fieldErrorKeys: Record<string, string> = {
  "error.email_required": "email",
  "error.email_invalid": "email",
  "error.email_exists": "email",
  "error.password_required": "password",
  "error.password_incorrect": "password",
  "error.invalid_credentials": "password",
};

export function createLiquidEngine(options: CreateLiquidOptions): Liquid {
  const templates: Record<string, string> = {
    [TEMPLATE_NAMES.default]: defaultTemplate,
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
  //
  // A key that misses the dictionary AND both fallbacks renders as the raw
  // key (graceful degradation) — with a warn-once console signal so template
  // authors see the miss instead of shipping `action.recover` to users.
  const warnedMissingKeys = new Set<string>();
  engine.registerFilter(
    "t",
    function tFilter(this: { context: unknown }, key: unknown, ...args: unknown[]) {
      const lookupKey = stringify(key);
      let template =
        options.locale[lookupKey] ??
        injectedKeyFallback(options.locale, lookupKey) ??
        fieldLabelFallback(lookupKey);
      if (template === undefined) {
        template = lookupKey;
        if (lookupKey !== "" && !warnedMissingKeys.has(lookupKey)) {
          warnedMissingKeys.add(lookupKey);
          console.warn(
            `[zitadel-login] missing text key "${lookupKey}" — rendering the raw key`,
          );
        }
      }
      return interpolate(template, args.map(stringify));
    },
  );

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
   * Builds `<zl-select>` options from a field's closed `validation.enum`. The
   * wire only carries the allowed values (strings), so the label defaults to the
   * value — author the enum with display-ready text. Piped through `| json` into
   * the element's `options` attribute.
   */
  engine.registerFilter("selectOptions", (values: unknown) => {
    if (!Array.isArray(values)) return [];
    return values.map((value) => {
      const v = stringify(value);
      return { value: v, label: v };
    });
  });

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

  /** Localized inline error for `fieldName`, or empty when none applies. */
  engine.registerFilter("fieldError", (fieldName: unknown, errors: unknown) => {
    const name = stringify(fieldName);
    if (!Array.isArray(errors)) return "";
    for (const item of errors) {
      const err = item as FlowError;
      if (err.field !== name) continue;
      // A catalog key localises through the active dictionary; a pre-localised
      // generic field error (no catalog entry) carries its `message` verbatim.
      return err.text_key ? (options.locale[err.text_key] ?? err.text_key) : (err.message ?? "");
    }
    return "";
  });

  /**
   * Automation-hook token for a field name: strips the
   * `x-auth-methods#` credential prefix so testids stay method-named
   * (`zitadel-field-password`), while the `name` attribute keeps the
   * raw wire key. See hookName for the contract.
   */
  engine.registerFilter("testid", (fieldName: unknown) => hookName(stringify(fieldName)));

  /**
   * True when the error should render as `<zl-alert>`, not on a field. A
   * field-scoped error (`field` set by {@link localiseFlowErrorKeys} when the
   * step renders that field) routes inline instead; everything else — engine
   * errors, and orphaned field errors already downgraded to a fieldless
   * message — falls to the banner.
   */
  engine.registerFilter("formLevelError", (err: unknown) => {
    return !(err as FlowError)?.field;
  });

  // `{% mandatory_gates %}` — emits a unique marker comment that the
  // orchestrator post-processes via `patchMandatoryGates`. The tag name is
  // owned by @zitadel/config so the authoring validator registers the same
  // dialect this engine renders.
  engine.registerTag(MANDATORY_GATES_TAG, {
    parse() {
      // No body, no args — nothing to consume.
    },
    render() {
      return mandatoryGatesMarkerComment;
    },
  });

  return engine;
}

/**
 * Fallbacks for text keys the flow engine derives from tenant-chosen step
 * names (`<step>.action.back` for the injected back action — see
 * `internal/domain/flow_state_machine.go` `buildStep`). Step names are open,
 * so no dictionary can enumerate them; a missing step-specific key falls back
 * to its generic entry instead of leaking the raw key into the UI.
 */
const INJECTED_KEY_FALLBACKS: ReadonlyArray<{ suffix: string; fallback: string }> = [
  { suffix: ".action.back", fallback: "action.back" },
];

function injectedKeyFallback(locale: Locale, key: string): string | undefined {
  for (const { suffix, fallback } of INJECTED_KEY_FALLBACKS) {
    if (key.endsWith(suffix)) return locale[fallback];
  }
  return undefined;
}

/**
 * Fallback for field-label keys (`<step>.field.<name>` — see
 * `FlowField.TextKey` in `internal/domain/flow_field_resolver.go`). Both
 * halves are tenant-chosen (step names and schema property names), so no
 * catalog can enumerate the keys; a miss renders a humanised property name
 * ("dateOfBirth" → "Date of birth") instead of leaking the raw key into the
 * form. Sub-keys like `.placeholder`/`.help` are excluded — they resolve
 * through their own filters, which stay empty on a miss.
 */
function fieldLabelFallback(key: string): string | undefined {
  const marker = ".field.";
  // Last occurrence: step names are tenant-chosen and may themselves
  // contain ".field."; the property name always follows the final marker.
  const index = key.lastIndexOf(marker);
  if (index === -1) return undefined;
  const field = key.slice(index + marker.length);
  if (field === "" || field.includes(".")) return undefined;
  return capitaliseFirst(humaniseFieldName(field));
}

export type FlowErrorKeyContext = {
  locale: Locale;
  /** Step name, for `<step>.field.<name>` label lookups. */
  stepName: string;
  /**
   * Names of the fields the step renders. When provided, an inline-routed
   * key (see `fieldErrorKeys`) whose field is absent is downgraded to a
   * pre-localised banner message — its inline outlet doesn't exist, and
   * `formLevelError` would otherwise suppress the banner too, silently
   * hiding the error. Omit to skip the check (pure lookups).
   */
  fields?: readonly string[];
};

/**
 * Rule-suffix fallbacks for the server's field-validation keys
 * (`error.<field>_<rule>` — see `FlowFieldValidationError.TextKey` in
 * `internal/domain/flow_field_resolver.go`). Field names come from the
 * tenant's user schema, so no catalog can enumerate the specific keys;
 * a miss resolves to the rule's generic entry, interpolated with the
 * field's label (`{0}`). The server spells the format rule `_invalid`
 * (the catalog's existing convention, e.g. `error.email_invalid`), so
 * that suffix takes the format wording; `_unknown_field` (a submitted
 * name that is not a step field) takes the catch-all.
 */
const FLOW_ERROR_RULE_FALLBACKS: ReadonlyArray<{ suffix: string; generic: string }> = [
  { suffix: "_required", generic: "error.field_required" },
  { suffix: "_min_length", generic: "error.field_min_length" },
  { suffix: "_max_length", generic: "error.field_max_length" },
  { suffix: "_format", generic: "error.field_format" },
  { suffix: "_invalid", generic: "error.field_format" },
  { suffix: "_unknown_field", generic: "error.field_invalid" },
];

const FLOW_ERROR_CATCH_ALL_KEY = "error.field_invalid";

/**
 * Localises a `step.error` payload of `error.*` catalog keys —
 * field-validation violations and general engine failures (e.g.
 * `error.invalid_credentials`, `error.passkey_invalid`) alike.
 * Returns `null` unless EVERY `"; "`-joined segment is an `error.*` key
 * — the caller keeps other payloads (outcome tokens such as
 * `user_not_found`) verbatim.
 *
 * Keys the locale knows pass through as `text_key` entries: the template
 * localises them via `| t`, and `fieldErrorKeys` routes the known ones
 * inline to their field. Unknown keys with a recognised rule suffix are
 * pre-localised here from their generic {@link FLOW_ERROR_RULE_FALLBACKS}
 * entry; unknown keys without one pass through as `text_key` (matching
 * `| t`'s behaviour for non-validation keys such as
 * `error.sign_in_server`, which localises via `.title`/`.body`).
 */
export function localiseFlowErrorKeys(
  raw: string,
  ctx: FlowErrorKeyContext,
): FlowError[] | null {
  const segments = raw.split("; ");
  if (!segments.every((segment) => segment.startsWith("error."))) return null;
  return segments.map((key) => localiseFlowErrorKey(key, ctx));
}

function localiseFlowErrorKey(key: string, ctx: FlowErrorKeyContext): FlowError {
  // An inline-routed key can only render on its field; when the step
  // doesn't carry that field, fall through to the pre-localised message
  // paths so the error surfaces as a banner instead of vanishing.
  const inlineField = fieldErrorKeys[key];
  const orphanedInline =
    inlineField !== undefined && ctx.fields !== undefined && !ctx.fields.includes(inlineField);
  if (!orphanedInline && ctx.locale[key] !== undefined) {
    // Catalog-known key. A field-mapped one (email/password) routes inline to
    // its field; an unmapped one (e.g. `error.sign_in_server`) stays
    // form-level, localising through its `.title`/`.body` sub-keys in the
    // alert filters.
    return inlineField !== undefined ? { field: inlineField, text_key: key } : { text_key: key };
  }
  for (const { suffix, generic } of FLOW_ERROR_RULE_FALLBACKS) {
    if (!key.endsWith(suffix)) continue;
    const field = key.slice("error.".length, key.length - suffix.length);
    if (field === "") break;
    const template =
      ctx.locale[generic] ?? ctx.locale[FLOW_ERROR_CATCH_ALL_KEY] ?? "Please check {0}.";
    const message = capitaliseFirst(interpolate(template, [fieldLabel(ctx, field)]));
    // Route inline when the step renders this field (the inline outlet exists);
    // otherwise keep it a banner message so it can never silently vanish. A
    // fields-less pure lookup can't confirm the outlet, so it stays a banner.
    const rendered = ctx.fields !== undefined && ctx.fields.includes(field);
    return rendered ? { field, message } : { message };
  }
  // Orphaned inline key without a recognised rule suffix (e.g.
  // `error.email_exists`): surface its catalog copy as a banner message.
  if (orphanedInline && ctx.locale[key] !== undefined) {
    return { message: ctx.locale[key] };
  }
  return { text_key: key };
}

/** `<step>.field.<name>` from the locale, else a humanised field name. */
function fieldLabel(ctx: FlowErrorKeyContext, field: string): string {
  const fromStep = ctx.locale[`${ctx.stepName}.field.${field}`];
  return fromStep ?? humaniseFieldName(field);
}

/**
 * `x-auth-methods#password` → "password", `givenName` → "given name",
 * `date_of_birth` → "date of birth".
 */
function humaniseFieldName(field: string): string {
  const afterHash = field.includes("#") ? (field.split("#").pop() as string) : field;
  return afterHash
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_.-]+/g, " ")
    .trim()
    .toLowerCase();
}

/** Messages may open with a lowercase field label; sentence-case them. */
function capitaliseFirst(text: string): string {
  return text.length > 0 ? text[0]?.toUpperCase() + text.slice(1) : text;
}

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

/**
 * Positional `{n}` substitution shared by the `| t` filter and the
 * pre-localising fallback in {@link localiseFlowErrorKeys}, so both
 * produce byte-identical output for the same template and args.
 */
function interpolate(template: string, args: readonly string[]): string {
  if (args.length === 0) return template;
  return template.replace(/\{(\d+)\}/g, (match, index) => {
    const i = Number(index);
    return args[i] ?? match;
  });
}
