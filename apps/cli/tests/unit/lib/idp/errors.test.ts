import { toZitadelError } from "@/lib/errors";
import { describe, expect, it } from "vitest";

import { IdpError, IdpProviderUnknownError, IdpSettingInvalidError } from "@/lib/idp";

describe("the identity-provider errors", () => {
  it.each([
    ["invalid", new IdpSettingInvalidError("invalid", "bad", { field: "--slug" }), "invalid"],
    ["conflicting", new IdpSettingInvalidError("conflicting", "bad", {}), "invalid"],
    ["missing", new IdpSettingInvalidError("missing", "bad", {}), "invalid"],
    ["unknown", new IdpProviderUnknownError("okta", ["google"]), "missing"],
  ] as const)("reports a %s failure by its category", (_name, error, category) => {
    expect(error).toBeInstanceOf(IdpError);
    expect(error.category).toBe(category);
  });

  it("reports an unknown provider with the code it always had", () => {
    expect(toZitadelError(new IdpProviderUnknownError("okta", ["google", "custom"]))).toMatchObject(
      {
        code: "E_VALIDATION",
        hint: "Use one of google, custom.",
      },
    );
  });

  it("words the advice for a refused setting with the flag it came from", () => {
    const error = new IdpSettingInvalidError("invalid", "--slug: bad", { field: "--slug" });

    expect(toZitadelError(error).hint).toBe("Fix --slug and run the command again.");
  });

  it("words the advice for settings that do not belong with the provider flag", () => {
    const error = new IdpSettingInvalidError("conflicting", "bad", {
      given: ["--issuer"],
      providerField: "--provider",
    });

    expect(toZitadelError(error).hint).toBe("Add --provider custom, or remove it.");
  });

  it("words the advice for a missing setting with the example", () => {
    const error = new IdpSettingInvalidError("missing", "bad", { example: "--provider custom" });

    expect(toZitadelError(error).hint).toBe("Describe the connection, e.g. --provider custom");
  });

  it("words the hint with the names the caller gave the settings", () => {
    expect(new IdpSettingInvalidError("invalid", "bad", { field: "slug" }).hint).toBe(
      "Fix slug and run the command again.",
    );
  });
});

describe("the identity-provider errors' codes", () => {
  it("reports an unknown provider as a validation failure, not a missing thing", () => {
    expect(new IdpProviderUnknownError("x", ["google"]).code).toBe("E_VALIDATION");
  });
});
