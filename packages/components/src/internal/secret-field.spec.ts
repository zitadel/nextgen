import { describe, expect, it } from "vitest";

import { isDisclosable } from "./secret-field.js";

describe("isDisclosable", () => {
  it.each([
    ["an email field", { type: "email" }],
    ["an email field that is the username", { type: "email", autocomplete: "username" }],
    ["a tel field", { type: "tel" }],
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
  ])("discloses %s", (_label, field) => {
    expect(isDisclosable(field)).toBe(true);
  });

  it.each([
    ["no definition at all", undefined],
    ["a password field", { type: "password" }],
    [
      "a password field that claims to be the username",
      { type: "password", autocomplete: "username" },
    ],
    ["a text field with no autocomplete, like a PIN", { type: "text" }],
    ["a text field with an unrelated autocomplete", { type: "text", autocomplete: "off" }],
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
    ["a number field", { type: "number" }],
    ["a url field", { type: "url" }],
    ["a date field", { type: "date" }],
    ["a hidden field", { type: "hidden" }],
    ["a checkbox field", { type: "checkbox" }],
    ["a select field", { type: "select" }],
    ["a field with no type", { autocomplete: "username" }],
  ])("keeps %s secret", (_label, field) => {
    expect(isDisclosable(field)).toBe(false);
  });
});
