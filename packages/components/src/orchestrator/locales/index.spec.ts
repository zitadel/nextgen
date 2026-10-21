import { describe, expect, it } from "vitest";

import { de } from "./de.js";
import { en } from "./en.js";
import { it as italian } from "./it.js";
import { localeFor, mergeLocale } from "./index.js";

describe("built-in locale dictionaries", () => {
  it("keeps translated locale keys aligned with English", () => {
    const englishKeys = Object.keys(en).sort();

    expect(Object.keys(de).sort()).toEqual(englishKeys);
    expect(Object.keys(italian).sort()).toEqual(englishKeys);
  });
});

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
});

describe("localeFor", () => {
  const locales = {
    en: { "identifier.title": "Welcome back", "company-details.title": "About your company" },
  };

  it("puts the integrator's English over the built-in English", () => {
    expect(localeFor("en-US", locales)["identifier.title"]).toBe("Welcome back");
  });

  it("keeps a built-in language's translations and fills its gaps with the integrator's English", () => {
    const locale = localeFor("de", locales);

    expect(locale["identifier.title"]).toBe(de["identifier.title"]);
    expect(locale["company-details.title"]).toBe("About your company");
  });

  it("gives a language with no built-in dictionary the integrator's English", () => {
    const locale = localeFor("fr", locales);

    expect(locale["identifier.title"]).toBe("Welcome back");
    expect(locale["identifier.description"]).toBe(en["identifier.description"]);
  });

  it("puts a language's own entries over the integrator's English", () => {
    const locale = localeFor("fr", { ...locales, fr: { "identifier.title": "Bon retour" } });

    expect(locale["identifier.title"]).toBe("Bon retour");
    expect(locale["company-details.title"]).toBe("About your company");
  });

  it("drops the integrator's English provider wording when a language rewrites the description", () => {
    const locale = localeFor("fr", {
      en: {
        "password.description": "Enter your Acme password",
        "password.description.sso": "Use your Acme password or Acme SSO",
      },
      fr: { "password.description": "Saisissez votre mot de passe Acme" },
    });

    expect(locale).not.toHaveProperty("password.description.sso");
  });
});
