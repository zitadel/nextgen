import { describe, expect, it } from "vitest";

import { isDisclosable } from "./secret-field.js";

describe("isDisclosable", () => {
  it.each([
    ["an email field that is the username", { type: "email", autocomplete: "username" }],
    ["an email field that is an email", { type: "email", autocomplete: "email" }],
    ["a tel field that is a phone number", { type: "tel", autocomplete: "tel" }],
    ["a text field that is the username", { type: "text", autocomplete: "username" }],
    ["a text field that is an email", { type: "text", autocomplete: "email" }],
    ["a text field that is a phone number", { type: "text", autocomplete: "tel" }],
    ["a text field that is a name", { type: "text", autocomplete: "name" }],
    ["a text field that is a given name", { type: "text", autocomplete: "given-name" }],
    ["a text field that is an additional name", { type: "text", autocomplete: "additional-name" }],
    ["a text field that is a family name", { type: "text", autocomplete: "family-name" }],
    ["a text field that is a nickname", { type: "text", autocomplete: "nickname" }],
    ["a sectioned username", { type: "text", autocomplete: "section-login username" }],
    ["an upper-case username token", { type: "text", autocomplete: "USERNAME" }],
    ["a username separated by a non-breaking space", { type: "text", autocomplete: "x username" }],
  ])("discloses %s", (_label, field) => {
    expect(isDisclosable(field)).toBe(true);
  });

  it.each([
    ["no definition at all", undefined],
    ["an email field with no autocomplete", { type: "email" }],
    ["a tel field with no autocomplete, like a numeric PIN", { type: "tel" }],
    ["a text field with no autocomplete, like a PIN", { type: "text" }],
    ["a text field with an unrelated autocomplete", { type: "text", autocomplete: "off" }],
    ["a text field with an empty autocomplete", { type: "text", autocomplete: "" }],
    ["a password field", { type: "password" }],
    [
      "a password field that claims to be the username",
      { type: "password", autocomplete: "username" },
    ],
    ["a number field", { type: "number", autocomplete: "username" }],
    ["a url field", { type: "url", autocomplete: "username" }],
    ["a date field", { type: "date", autocomplete: "username" }],
    ["a hidden field", { type: "hidden", autocomplete: "username" }],
    ["a checkbox field", { type: "checkbox", autocomplete: "username" }],
    ["a select field", { type: "select", autocomplete: "username" }],
    ["a field with no type", { autocomplete: "username" }],
    ["a text field holding a one-time code", { type: "text", autocomplete: "one-time-code" }],
    [
      "a text field holding a sectioned one-time code",
      { type: "text", autocomplete: "section-2fa one-time-code" },
    ],
    ["a text field holding a current password", { type: "text", autocomplete: "current-password" }],
    ["a text field holding a new password", { type: "text", autocomplete: "new-password" }],
    ["an email field holding a one-time code", { type: "email", autocomplete: "one-time-code" }],
    [
      "an upper-case secret token on an email field",
      { type: "email", autocomplete: "ONE-TIME-CODE" },
    ],
    ["a tel field holding a new password", { type: "tel", autocomplete: "new-password" }],
    [
      "a username that is also a one-time code",
      { type: "text", autocomplete: "username one-time-code" },
    ],
    ["a username next to a card security code", { type: "text", autocomplete: "username cc-csc" }],
    ["a card number next to a username", { type: "text", autocomplete: "cc-number username" }],
    ["an email field holding a card number", { type: "email", autocomplete: "cc-number" }],
    [
      "an email field holding a card number and an email",
      { type: "email", autocomplete: "email cc-exp" },
    ],
    [
      "a username next to a transaction amount",
      { type: "text", autocomplete: "username transaction-amount" },
    ],
    ["a username next to a birthday", { type: "text", autocomplete: "username bday" }],
    ["a username next to a birth year", { type: "text", autocomplete: "username bday-year" }],
    [
      "a new password followed by a zero-width space",
      { type: "text", autocomplete: "username new-password​" },
    ],
    [
      "a new password split by a zero-width joiner",
      { type: "text", autocomplete: "username new-pass‍word" },
    ],
    [
      "a new password after a non-breaking space",
      { type: "text", autocomplete: "username new-password" },
    ],
  ])("keeps %s secret", (_label, field) => {
    expect(isDisclosable(field)).toBe(false);
  });
});
