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

import type { CreateFlow201StepFieldsItem } from "@zitadel/api/generated/model";
import type { FlowError } from "./template-context.js";
import type { Locale } from "./locales/en.js";
import { hookName } from "../internal/hook-name.js";
import { mandatoryGatesMarkerComment } from "./mandatory-gates.js";
import {
  SSO_DESCRIPTION_SUFFIX,
  capitaliseFirst,
  humaniseFieldName,
  interpolate,
} from "./locales/step-text.js";
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
      const requested = stringify(key);
      // A step with providers asks for `<step>.description.sso`; when neither it
      // nor the plain description exists, the plain key is the one to add.
      const lookupKey =
        requested.endsWith(SSO_DESCRIPTION_SUFFIX) &&
        options.locale[requested] === undefined &&
        options.locale[requested.slice(0, -".sso".length)] === undefined
          ? requested.slice(0, -".sso".length)
          : requested;
      let template =
        options.locale[lookupKey] ??
        injectedKeyFallback(options.locale, lookupKey) ??
        fieldLabelFallback(lookupKey);
      if (template === undefined) {
        template = lookupKey;
        if (lookupKey !== "" && !warnedMissingKeys.has(lookupKey)) {
          warnedMissingKeys.add(lookupKey);
          console.warn(`[zitadel-login] missing text key "${lookupKey}" — rendering the raw key`);
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
   * A field's help text, or, when it has none, a hint from the rules its
   * validation declares: the minimum length of a password the user chooses.
   * The server sets it from the project's password policy only where a
   * password is chosen, so a sign-in step never shows it. Without the hint the
   * rule surfaces only as an error after the first submit (#251).
   *
   * It filters the help text rather than the field so an ejected template that
   * uses it degrades on an older runtime: without `strictFilters` an unknown
   * filter passes its input through, which is the help text, not the field.
   */
  engine.registerFilter("fieldRuleHint", (help: unknown, field: unknown) => {
    const text = stringify(help);
    if (text !== "") return text;
    const { type, validation } = (field ?? {}) as Partial<CreateFlow201StepFieldsItem>;
    const minLength = validation?.min_length;
    if (type !== "password" || minLength === undefined || minLength <= 0) return "";
    const template = options.locale["hint.field_min_length"];
    return template === undefined ? "" : interpolate(template, [String(minLength)]);
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
  // A step that offers providers asks for `<step>.description.sso` (see
  // `buildStep`). Only the steps whose plain text would mislead need their own;
  // every other step, and any locale written before the key existed, shows the
  // plain description.
  if (key.endsWith(SSO_DESCRIPTION_SUFFIX)) {
    return locale[key.slice(0, -".sso".length)];
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
