/**
 * Locale resolution for the login widgets.
 *
 * English is bundled and is the fallback for every language. The other
 * built-in translations load on demand ({@link loadLocale}), so a page
 * downloads only the one it shows. An app that wants a translation as a
 * value, to extend it, imports it from `@zitadel/components/locales`.
 */
export { en, type Locale } from "./en.js";
export { businessLocales } from "./business.js";

import { en, type Locale } from "./en.js";

/**
 * The variant of a step's description or notice that the step asks for when
 * the identifier it collects is not an email address, such as a schema whose
 * `x-identifier` is `employee_number`: the plain sentence may name the email.
 */
export const CUSTOM_IDENTIFIER_SUFFIX = ".custom_identifier";

/**
 * The variants of a text key: `.sso` for a `<step>.description` when the step
 * offers sign-in providers, which the server asks for, and
 * {@link CUSTOM_IDENTIFIER_SUFFIX}.
 */
const VARIANT_SUFFIXES = [".sso", CUSTOM_IDENTIFIER_SUFFIX];

/**
 * A built-in dictionary with an integrator's `locales` entries on top.
 *
 * Entries are partial: they merge key by key, and an explicit `undefined` is
 * skipped rather than shadowing the built-in copy.
 *
 * A step can ask for a variant of a key (a step that offers sign-in providers
 * asks for `<step>.description.sso`), and falls back to the plain key only
 * when the variant is missing. So when the integrator wrote their own text
 * for a key but not a variant of their own (absent, or the built-in one copied
 * in by spreading a built-in dictionary), the built-in variant is dropped:
 * theirs is what shows, rather than built-in copy, possibly in another
 * language, that they never saw.
 */
export function mergeLocale(builtin: Locale, custom: Partial<Locale>): Locale {
  const merged: Locale = { ...builtin };
  for (const [key, value] of Object.entries(custom)) {
    if (value !== undefined) merged[key] = value;
  }
  for (const [key, value] of Object.entries(custom)) {
    if (value === undefined || value === builtin[key]) continue;
    for (const suffix of VARIANT_SUFFIXES) {
      // A dictionary built by spreading a built-in one carries the built-in
      // variants too, so a copied value counts as not written.
      const variant = custom[`${key}${suffix}`];
      if (variant === undefined || variant === builtin[`${key}${suffix}`]) {
        delete merged[`${key}${suffix}`];
      }
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
 *
 * @param tag - The BCP 47 language tag.
 * @param locales - The integrator's dictionaries, by primary subtag.
 * @param builtin - The built-in dictionary for the tag's language, which the
 *   caller loads ({@link loadLocale}); `undefined` for English or a language with none.
 * @returns The merged dictionary.
 */
export function localeFor(
  tag: string,
  locales?: Readonly<Record<string, Partial<Locale>>>,
  builtin?: Locale,
): Locale {
  const language = primaryLanguage(tag);
  const custom = locales?.[language];
  const fallback = locales?.en;
  if (language === "en" || !fallback) {
    const base = builtin ?? en;
    return custom ? mergeLocale(base, custom) : base;
  }

  // The built-in dictionaries share their keys, so merging one over the
  // integrator's English keeps only the keys they added themselves.
  const english = mergeLocale(en, fallback);
  const base = builtin ? mergeLocale(english, builtin) : english;
  return custom ? mergeLocale(base, custom) : base;
}

/**
 * Whether the integrator hid a key's text by setting it to `""`: for the tag's
 * language or, when they wrote no text of their own for it there, in `en`.
 * Unlike {@link localeFor}, a built-in translation does not override an
 * English `""`, so one entry hides the text in every language.
 */
export function isHidden(
  tag: string,
  locales: Readonly<Record<string, Partial<Locale>>> | undefined,
  key: string,
): boolean {
  return (locales?.[primaryLanguage(tag)]?.[key] ?? locales?.en?.[key]) === "";
}

/**
 * The built-in translations besides English, by primary language subtag.
 */
const TRANSLATIONS: Readonly<Record<string, () => Promise<Locale>>> = {
  de: async () => (await import("./de.js")).de,
  it: async () => (await import("./it.js")).it,
};

/**
 * Loads the dictionary for a BCP 47 language tag: its built-in translation,
 * if there is one, with the integrator's `locales` merged over it
 * ({@link localeFor}).
 *
 * @param tag - The BCP 47 language tag.
 * @param locales - The integrator's dictionaries, by primary subtag.
 * @returns The merged dictionary.
 */
export async function loadLocale(
  tag: string,
  locales: Readonly<Record<string, Partial<Locale>>> | undefined,
): Promise<Locale> {
  return localeFor(tag, locales, await TRANSLATIONS[primaryLanguage(tag)]?.());
}

/**
 * The primary subtag of a language tag, lowercased.
 *
 * @param tag - The BCP 47 language tag.
 * @returns The language, `de` for `de-CH`.
 */
function primaryLanguage(tag: string): string {
  return (tag.split("-")[0] ?? "").toLowerCase();
}
