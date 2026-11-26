/**
 * Loads the dictionary for the page's language. Each built-in translation
 * besides English is its own chunk, so a page downloads only the one it shows.
 * An app that wants a translation as a value, to extend it, imports it from
 * `@zitadel/components/locales`.
 */
import type { Locale } from "./en.js";
import { localeFor, primaryLanguage } from "./index.js";

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
