/**
 * Business-flavored locale overlay.
 *
 * The built-in dictionaries ship neutral email copy ("Email" /
 * "you@example.com") so the default UI fits any audience. B2B products that
 * want the previous work-email framing spread this overlay on top of the
 * matching built-in dictionary via the `locales` property:
 *
 * ```ts
 * import { en, businessLocales } from "@zitadel/components";
 * loginElement.locales = { en: { ...en, ...businessLocales.en } };
 * ```
 *
 * Each entry is a partial dictionary carrying only the affected keys —
 * deliberately exempt from the en/de/it key-parity check that guards the
 * full built-in dictionaries.
 */
import type { Locale } from "./en.js";

/**
 * The business copy overlay: the dictionary entries that frame the sign-in form for a business
 * audience, for example "Work email" where the built-in copy says "Email".
 *
 * The built-in dictionaries are neutral so that the default UI fits any audience. A product that
 * serves businesses spreads this overlay on top of the matching built-in dictionary and passes the
 * result through the `locales` property of a widget. Each entry carries only the keys it changes,
 * so it is not meant to stand alone as a dictionary, and it is exempt from the key-parity check
 * that guards the full built-in dictionaries.
 *
 * Every SDK re-exports this value, so an app never needs a direct dependency on
 * `@zitadel/components`, which strict package managers refuse to resolve from an app that does not
 * declare it. On edge runtimes the components package resolves to a build without elements that
 * still carries this data, so it is safe to import everywhere.
 *
 * @example
 * ```ts
 * import { businessLocales } from "@zitadel/sdk-react";
 *
 * <ZitadelLogin project={project} locales={businessLocales} />;
 * ```
 */
export const businessLocales: Readonly<Record<string, Partial<Locale>>> = {
  en: {
    "identifier.field.email": "Work email",
    "identifier.field.email.placeholder": "you@company.com",
    "collect-credentials.field.email": "Work email",
    "collect-credentials.field.email.placeholder": "you@company.com",
    "collect-passkey-email.field.email": "Work email",
    "collect-passkey-email.field.email.placeholder": "you@company.com",
    "register.field.email": "Work email",
    "register.field.email.placeholder": "you@company.com",
  },
  de: {
    "identifier.field.email": "Geschäftliche E-Mail",
    "identifier.field.email.placeholder": "du@unternehmen.com",
    "collect-credentials.field.email": "Geschäftliche E-Mail",
    "collect-credentials.field.email.placeholder": "du@unternehmen.com",
    "collect-passkey-email.field.email": "Geschäftliche E-Mail",
    "collect-passkey-email.field.email.placeholder": "du@unternehmen.com",
    "register.field.email": "Geschäftliche E-Mail",
    "register.field.email.placeholder": "du@unternehmen.com",
  },
  it: {
    "identifier.field.email": "E-mail aziendale",
    "identifier.field.email.placeholder": "tu@azienda.com",
    "collect-credentials.field.email": "E-mail aziendale",
    "collect-credentials.field.email.placeholder": "tu@azienda.com",
    "collect-passkey-email.field.email": "E-mail aziendale",
    "collect-passkey-email.field.email.placeholder": "tu@azienda.com",
    "register.field.email": "E-mail aziendale",
    "register.field.email.placeholder": "tu@azienda.com",
  },
};
