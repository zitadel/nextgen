import { describe, expect, it } from "vitest";

import { de } from "./de.js";
import { en } from "./en.js";
import { it as italian } from "./it.js";
import { mergeLocale, Translations } from "./translations.js";

describe("mergeLocale", () => {
  const builtin = {
    "password.description": "Enter your password",
    "password.description.sso": "Enter your password or continue with your sign-in provider",
    "identifier.title": "Sign in",
  };

  it("puts the integrator's entries over the built-in ones", () => {
    expect(mergeLocale(builtin, { "identifier.title": "Welcome" })["identifier.title"]).toBe(
      "Welcome",
    );
  });

  it("skips an explicit undefined rather than blanking the built-in copy", () => {
    expect(mergeLocale(builtin, { "identifier.title": undefined })["identifier.title"]).toBe(
      "Sign in",
    );
  });

  it("drops the built-in provider wording of a description the integrator rewrote", () => {
    const merged = mergeLocale(builtin, { "password.description": "Enter your Acme password" });

    expect(merged).not.toHaveProperty("password.description.sso");
  });

  it("keeps the integrator's own provider wording", () => {
    const merged = mergeLocale(builtin, {
      "password.description": "Enter your Acme password",
      "password.description.sso": "Use your Acme password or Acme SSO",
    });

    expect(merged["password.description.sso"]).toBe("Use your Acme password or Acme SSO");
  });

  it("drops it too when the integrator spread a built-in dictionary and rewrote the description", () => {
    const merged = mergeLocale(builtin, {
      ...builtin,
      "password.description": "Enter your Acme password",
    });

    expect(merged).not.toHaveProperty("password.description.sso");
  });

  it("keeps it when a spread dictionary leaves the description as it was", () => {
    const merged = mergeLocale(builtin, { ...builtin, "identifier.title": "Welcome" });

    expect(merged["password.description.sso"]).toBe(builtin["password.description.sso"]);
  });

  it("keeps the built-in provider wording when the integrator left the description alone", () => {
    const merged = mergeLocale(builtin, { "identifier.title": "Welcome" });

    expect(merged["password.description.sso"]).toBe(builtin["password.description.sso"]);
  });

  describe("the wording for an identifier that is not an email", () => {
    const withVariant = {
      "identifier.description": "Enter your email to continue",
      "identifier.description.custom_identifier": "Enter your details to continue",
    };

    it("is dropped from a description the integrator rewrote", () => {
      const merged = mergeLocale(withVariant, {
        "identifier.description": "Enter your employee number",
      });

      expect(merged).not.toHaveProperty("identifier.description.custom_identifier");
    });

    it("is kept when the integrator wrote it too", () => {
      const merged = mergeLocale(withVariant, {
        "identifier.description": "Enter your employee number",
        "identifier.description.custom_identifier": "Enter your employee number",
      });

      expect(merged["identifier.description.custom_identifier"]).toBe("Enter your employee number");
    });

    it("is dropped from a notice the integrator rewrote", () => {
      const merged = mergeLocale(
        {
          "notice.user_not_found": "We couldn't find an account for that email.",
          "notice.user_not_found.custom_identifier": "We couldn't find an account.",
        },
        { "notice.user_not_found": "No employee has that number yet." },
      );

      expect(merged).not.toHaveProperty("notice.user_not_found.custom_identifier");
    });
  });
});

describe("Translations.texts", () => {
  const locales = {
    en: { "identifier.title": "Welcome back", "company-details.title": "About your company" },
  };

  it("puts the integrator's English over the built-in English", () => {
    expect(Translations.english("en-US", locales).texts["identifier.title"]).toBe("Welcome back");
  });

  it("keeps a built-in language's translations and fills its gaps with the integrator's English", async () => {
    const locale = (await Translations.load("de", locales)).texts;

    expect(locale["identifier.title"]).toBe(de["identifier.title"]);
    expect(locale["company-details.title"]).toBe("About your company");
  });

  it("gives a language with no built-in dictionary the integrator's English", () => {
    const locale = Translations.english("fr", locales).texts;

    expect(locale["identifier.title"]).toBe("Welcome back");
    expect(locale["identifier.description"]).toBe(en["identifier.description"]);
  });

  it("puts a language's own entries over the integrator's English", () => {
    const locale = Translations.english("fr", {
      ...locales,
      fr: { "identifier.title": "Bon retour" },
    }).texts;

    expect(locale["identifier.title"]).toBe("Bon retour");
    expect(locale["company-details.title"]).toBe("About your company");
  });

  it("drops the integrator's English provider wording when a language rewrites the description", () => {
    const locale = Translations.english("fr", {
      en: {
        "password.description": "Enter your Acme password",
        "password.description.sso": "Use your Acme password or Acme SSO",
      },
      fr: { "password.description": "Saisissez votre mot de passe Acme" },
    }).texts;

    expect(locale).not.toHaveProperty("password.description.sso");
  });
});

describe("Translations.isHidden", () => {
  const key = "notice.user_not_found";

  it("hides a text the integrator set to an empty string in English for every language", () => {
    const locales = { en: { [key]: "" } };

    expect(Translations.english("en-US", locales).isHidden(key)).toBe(true);
    expect(Translations.english("de-DE", locales).isHidden(key)).toBe(true);
    expect(Translations.english("fr", locales).isHidden(key)).toBe(true);
  });

  it("shows a language's own text over an English empty string", () => {
    const locales = { en: { [key]: "" }, de: { [key]: "Neues Konto" } };

    expect(Translations.english("de", locales).isHidden(key)).toBe(false);
    expect(Translations.english("it", locales).isHidden(key)).toBe(true);
  });

  it("hides a text only in the language that sets it to an empty string", () => {
    const locales = { de: { [key]: "" } };

    expect(Translations.english("de", locales).isHidden(key)).toBe(true);
    expect(Translations.english("en", locales).isHidden(key)).toBe(false);
  });

  it("hides nothing without integrator text", () => {
    expect(Translations.english("en", undefined).isHidden(key)).toBe(false);
    expect(Translations.english("en", { en: { [key]: "New account" } }).isHidden(key)).toBe(false);
  });
});

describe("Translations.load", () => {
  it.each([
    ["de-CH", de],
    ["it", italian],
    ["en-GB", en],
    ["fr", en],
    ["__proto__", en],
    ["constructor", en],
  ])("loads the built-in dictionary for %s", async (tag, expected) => {
    expect((await Translations.load(tag)).texts).toEqual(expected);
  });

  it("merges the integrator's text over the loaded translation", async () => {
    const locale = (await Translations.load("de", { de: { "identifier.title": "Willkommen" } }))
      .texts;

    expect(locale["identifier.title"]).toBe("Willkommen");
  });
});
