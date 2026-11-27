/**
 * The built-in dictionaries as values, for an app that extends one through the
 * `locales` property. The widgets pick and load the translation for the page's
 * language themselves, so an app needs this entry only to change their text.
 *
 * @example
 * ```ts
 * import { de } from "@zitadel/components/locales";
 *
 * login.locales = { de: { ...de, "identifier.title": "Willkommen" } };
 * ```
 */
import { de } from "./orchestrator/locales/de.js";
import { en, type Locale } from "./orchestrator/locales/en.js";
import { it } from "./orchestrator/locales/it.js";

export { businessLocales } from "./orchestrator/locales/business.js";
export { de, en, it, type Locale };

/**
 * Every built-in dictionary, by primary language subtag.
 */
export const builtinLocales: Readonly<Record<string, Locale>> = { en, de, it };
