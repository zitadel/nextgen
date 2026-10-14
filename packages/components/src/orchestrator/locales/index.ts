/**
 * Built-in locale registry.
 *
 * Re-exports the individual dictionaries and provides a `builtinLocales`
 * map so the orchestrator can resolve a BCP 47 language tag to the
 * matching dictionary at runtime.
 */
export { en, type Locale } from "./en.js";
export { de } from "./de.js";
export { it } from "./it.js";
export { businessLocales } from "./business.js";

import { en, type Locale } from "./en.js";
import { de } from "./de.js";
import { it } from "./it.js";

export const builtinLocales: Readonly<Record<string, Locale>> = { en, de, it };

/**
 * A built-in dictionary with an integrator's `locales` entries on top.
 *
 * Entries are partial: they merge key by key, and an explicit `undefined` is
 * skipped rather than shadowing the built-in copy.
 *
 * A step that offers sign-in providers asks for `<step>.description.sso`, and
 * the `t` filter falls back to `<step>.description` only when the first is
 * missing. So when the integrator wrote their own `<step>.description` but no
 * `.sso` variant, the built-in `.sso` sentence is dropped: theirs is what shows,
 * rather than built-in copy, possibly in another language, that they never saw.
 */
export function mergeLocale(builtin: Locale, custom: Partial<Locale>): Locale {
  const merged: Locale = { ...builtin };
  for (const [key, value] of Object.entries(custom)) {
    if (value !== undefined) merged[key] = value;
  }
  for (const [key, value] of Object.entries(custom)) {
    if (value !== undefined && key.endsWith(".description") && custom[`${key}.sso`] === undefined) {
      delete merged[`${key}.sso`];
    }
  }
  return merged;
}
