import { describe, expect, it } from "vitest";

import { toZitadelError } from "@/lib/errors";
import {
  IdpError,
  IdpProviderUnknownError,
  IdpSettingRefusedError,
  IdpSettingsConflictError,
  IdpSettingsMissingError,
} from "@/lib/idp";

describe("the identity-provider errors", () => {
  it.each([
    ["refused", new IdpSettingRefusedError("bad"), "invalid"],
    ["conflict", new IdpSettingsConflictError("bad"), "invalid"],
    ["missing", new IdpSettingsMissingError("bad"), "invalid"],
    ["unknown", new IdpProviderUnknownError("bad"), "missing"],
  ] as const)("reports a %s failure by its category", (_name, error, category) => {
    expect(error).toBeInstanceOf(IdpError);
    expect(error.category).toBe(category);
  });

  it("reports an unknown provider with the code it always had", () => {
    expect(toZitadelError(new IdpProviderUnknownError("Unknown provider okta"))).toMatchObject({
      code: "E_VALIDATION",
      message: "Unknown provider okta",
    });
  });
});

describe("the identity-provider errors' codes", () => {
  it.each([
    ["a refused setting", new IdpSettingRefusedError("bad")],
    ["settings that conflict", new IdpSettingsConflictError("bad")],
    ["settings that are missing", new IdpSettingsMissingError("bad")],
    ["an unknown provider", new IdpProviderUnknownError("bad")],
  ] as const)("reports %s as a validation failure", (_name, error) => {
    expect(error.code).toBe("E_VALIDATION");
  });
});
