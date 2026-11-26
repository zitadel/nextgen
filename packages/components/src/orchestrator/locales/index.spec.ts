import { describe, expect, it } from "vitest";

import { de } from "./de.js";
import { en } from "./en.js";
import { it as italian } from "./it.js";
import { builtinLocales } from "../../locales.js";

describe("built-in locale dictionaries", () => {
  it("keeps translated locale keys aligned with English", () => {
    const englishKeys = Object.keys(en).sort();

    expect(Object.keys(de).sort()).toEqual(englishKeys);
    expect(Object.keys(italian).sort()).toEqual(englishKeys);
  });

  // The schema's identifier may be an employee number rather than an email.
  // The variants show only for such an identifier; the other keys show on
  // steps that cannot tell what it is.
  it.each(Object.entries(builtinLocales))(
    "names no email where the identifier may be another field (%s)",
    (_, locale) => {
      for (const key of [
        "identifier.description.custom_identifier",
        "notice.user_not_found.custom_identifier",
        "passkey-first.action.email_fallback",
        "notice.user_already_exists",
        "error.invalid_credentials",
        "error.password_incorrect",
        "error.passkey_not_registered",
      ]) {
        expect(locale[key], key).toBeDefined();
        expect(locale[key], key).not.toMatch(/mail/i);
      }
    },
  );
});
