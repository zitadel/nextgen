import { describe, expect, it } from "vitest";

import { IdpError, IdpProviderUnknownError, IdpSettingsInvalidError } from "@/lib/idp";

describe("the identity-provider errors", () => {
  it.each([
    ["invalid settings", new IdpSettingsInvalidError("bad"), "invalid"],
    ["unknown", new IdpProviderUnknownError("bad"), "missing"],
  ] as const)("reports a %s failure by its category", (_name, error, category) => {
    expect(error).toBeInstanceOf(IdpError);
    expect(error.category).toBe(category);
  });
});

describe("the identity-provider errors' codes", () => {
  it.each([
    ["invalid settings", new IdpSettingsInvalidError("bad")],
    ["an unknown provider", new IdpProviderUnknownError("bad")],
  ] as const)("reports %s as a validation failure", (_name, error) => {
    expect(error.code).toBe("E_VALIDATION");
  });
});
