import { describe, expect, it } from "vitest";

import {
  IdpError,
  IdpProviderUnknownError,
  IdpSettingsInvalidError,
  IdpSettingsMissingError,
  IdpSettingsUnusedError,
} from "@/lib/idp";

describe("the identity-provider errors", () => {
  it.each([
    ["invalid settings", new IdpSettingsInvalidError("--issuer", "bad"), "invalid"],
    ["unused settings", new IdpSettingsUnusedError(["--issuer"], "--provider"), "invalid"],
    ["missing settings", new IdpSettingsMissingError(["--issuer"], "e.g."), "invalid"],
    ["unknown", new IdpProviderUnknownError("bad", ["google"]), "missing"],
  ] as const)("reports a %s failure by its category", (_name, error, category) => {
    expect(error).toBeInstanceOf(IdpError);
    expect(error.category).toBe(category);
  });
});

describe("the identity-provider errors' codes", () => {
  it.each([
    ["invalid settings", new IdpSettingsInvalidError("--issuer", "bad")],
    ["unused settings", new IdpSettingsUnusedError(["--issuer"], "--provider")],
    ["missing settings", new IdpSettingsMissingError(["--issuer"], "e.g.")],
    ["an unknown provider", new IdpProviderUnknownError("bad", ["google"])],
  ] as const)("reports %s as a validation failure", (_name, error) => {
    expect(error.code).toBe("E_VALIDATION");
  });
});
