import { describe, expect, it } from "vitest";

import { toZitadelError } from "@/lib/errors";
import { IdpError, IdpProviderUnknownError, IdpSettingInvalidError } from "@/lib/idp";

describe("the identity-provider errors", () => {
  it.each([
    ["invalid", new IdpSettingInvalidError("invalid", "bad", { field: "--slug" }), "validation"],
    ["conflicting", new IdpSettingInvalidError("conflicting", "bad", {}), "validation"],
    ["missing", new IdpSettingInvalidError("missing", "bad", {}), "validation"],
    ["unknown", new IdpProviderUnknownError("okta", ["google"]), "not_found"],
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

  it("keeps the library's hint free of flags", () => {
    expect(new IdpSettingInvalidError("invalid", "bad", { field: "--slug" }).hint).toBeUndefined();
  });
});
