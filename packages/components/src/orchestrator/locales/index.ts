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
 * `.sso` variant of their own (absent, or the built-in one copied in by spreading
 * a built-in dictionary), the built-in `.sso` sentence is dropped: theirs is what shows,
 * rather than built-in copy, possibly in another language, that they never saw.
 */
export function mergeLocale(builtin: Locale, custom: Partial<Locale>): Locale {
  const merged: Locale = { ...builtin };
  for (const [key, value] of Object.entries(custom)) {
    if (value !== undefined) merged[key] = value;
  }
  for (const [key, value] of Object.entries(custom)) {
    if (value === undefined || !key.endsWith(".description") || value === builtin[key]) continue;
    // A dictionary built by spreading a built-in one carries the built-in
    // provider sentence too, so a copied value counts as not written.
    const sso = custom[`${key}.sso`];
    if (sso === undefined || sso === builtin[`${key}.sso`]) {
      delete merged[`${key}.sso`];
    }
  }
  return merged;
}

/**
 * The dictionary for a BCP 47 language tag. Its layers, strongest first: the
 * integrator's `locales` entries for the tag's primary subtag, the built-in
 * dictionary for it, their `en` entries, and the built-in English.
 *
 * The integrator's English is thus the fallback for every language: a key a
 * language has no text for, such as one for a step they added, shows their
 * English rather than the raw key, while a built-in translation still beats it.
 */
export function localeFor(
  tag: string,
  locales?: Readonly<Record<string, Partial<Locale>>>,
): Locale {
  const language = (tag.split("-")[0] ?? "").toLowerCase();
  const custom = locales?.[language];
  const fallback = locales?.en;
  if (language === "en" || !fallback) {
    const builtin = builtinLocales[language] ?? en;
    return custom ? mergeLocale(builtin, custom) : builtin;
  }

  // The built-in dictionaries share their keys, so merging one over the
  // integrator's English keeps only the keys they added themselves.
  const english = mergeLocale(en, fallback);
  const builtin = builtinLocales[language];
  const base = builtin ? mergeLocale(english, builtin) : english;
  return custom ? mergeLocale(base, custom) : base;
}
