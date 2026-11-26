/**
 * The texts the login widgets render in: the translation for the page's
 * language, loaded on demand, with the app's `locales` merged over it.
 */
import { en, type Locale } from "./en.js";

/**
 * The app's own dictionaries, by primary language subtag, as the widgets'
 * `locales` property takes them.
 */
export type AppLocales = Readonly<Record<string, Partial<Locale>>>;

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
 * The built-in translations besides English, by primary language subtag. Each
 * loads with a dynamic import, so a page downloads only the one it shows.
 */
const BUILTIN: Readonly<Record<string, () => Promise<Locale>>> = {
  de: async () => (await import("./de.js")).de,
  it: async () => (await import("./it.js")).it,
};

/**
 * The texts for one language tag. Their layers, strongest first: the app's
 * `locales` entries for the tag's primary subtag, the built-in translation
 * for it, the app's `en` entries, and the built-in English.
 *
 * The app's English is thus the fallback for every language: a key a language
 * has no text for, such as one for a step the app added, shows the app's
 * English rather than the raw key, while a built-in translation still beats it.
 */
export class Translations {
  /**
   * The merged texts, by key.
   */
  readonly texts: Locale;

  private readonly language: string;

  private readonly locales: AppLocales | undefined;

  /**
   * @param language - The primary language subtag.
   * @param locales - The app's dictionaries.
   * @param builtin - The built-in translation for the language, if any.
   */
  private constructor(language: string, locales: AppLocales | undefined, builtin?: Locale) {
    this.language = language;
    this.locales = locales;
    this.texts = Translations.merge(language, locales, builtin);
  }

  /**
   * Loads the texts for a BCP 47 language tag, with its built-in translation.
   *
   * @param tag - The BCP 47 language tag.
   * @param locales - The app's dictionaries.
   * @returns The texts.
   */
  static async load(tag: string, locales?: AppLocales): Promise<Translations> {
    const language = Translations.languageOf(tag);
    const builtin = Object.hasOwn(BUILTIN, language) ? await BUILTIN[language]?.() : undefined;
    return new Translations(language, locales, builtin);
  }

  /**
   * The texts for a BCP 47 language tag from the bundled English only, for
   * use before {@link load} has finished.
   *
   * @param tag - The BCP 47 language tag.
   * @param locales - The app's dictionaries.
   * @returns The texts.
   */
  static english(tag: string, locales?: AppLocales): Translations {
    return new Translations(Translations.languageOf(tag), locales);
  }

  /**
   * Whether the app hid a key's text by setting it to `""`: for this
   * language or, when it wrote no text of its own for it there, in `en`. A
   * built-in translation does not override an English `""`, so one entry
   * hides the text in every language.
   *
   * @param key - The text key.
   * @returns `true` when the app hid it.
   */
  isHidden(key: string): boolean {
    return (this.locales?.[this.language]?.[key] ?? this.locales?.en?.[key]) === "";
  }

  /**
   * Merges the layers for a language.
   *
   * @param language - The primary language subtag.
   * @param locales - The app's dictionaries.
   * @param builtin - The built-in translation, if any.
   * @returns The merged texts.
   */
  private static merge(
    language: string,
    locales: AppLocales | undefined,
    builtin?: Locale,
  ): Locale {
    const custom = locales?.[language];
    const fallback = locales?.en;
    if (language === "en" || !fallback) {
      const base = builtin ?? en;
      return custom ? mergeLocale(base, custom) : base;
    }
    const english = mergeLocale(en, fallback);
    const base = builtin ? mergeLocale(english, builtin) : english;
    return custom ? mergeLocale(base, custom) : base;
  }

  /**
   * The primary subtag of a language tag, lowercased.
   *
   * @param tag - The BCP 47 language tag.
   * @returns The language, `de` for `de-CH`.
   */
  private static languageOf(tag: string): string {
    return (tag.split("-")[0] ?? "").toLowerCase();
  }
}
