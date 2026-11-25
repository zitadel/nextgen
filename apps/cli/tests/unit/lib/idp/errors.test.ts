import { toZitadelError } from "@/lib/errors";
import { describe, expect, it } from "vitest";

import {
  IdpError,
  IdpProviderUnknownError,
  IdpSettingRefusedError,
  IdpSettingsConflictError,
  IdpSettingsMissingError,
} from "@/lib/idp";

describe("the identity-provider errors", () => {
  it.each([
    ["refused", new IdpSettingRefusedError("bad", "--slug"), "invalid"],
    ["conflict", new IdpSettingsConflictError("bad", ["--issuer"]), "invalid"],
    ["missing", new IdpSettingsMissingError("bad", ["--slug"], "e.g."), "invalid"],
    ["unknown", new IdpProviderUnknownError("okta", ["google"]), "missing"],
  ] as const)("reports a %s failure by its category", (_name, error, category) => {
    expect(error).toBeInstanceOf(IdpError);
    expect(error.category).toBe(category);
  });

  it("reports an unknown provider with the code it always had", () => {
    expect(toZitadelError(new IdpProviderUnknownError("okta", ["google", "custom"]))).toMatchObject(
      {
        code: "E_VALIDATION",
        hint: "Known providers: google, custom.",
      },
    );
  });

  it("keeps the flag a refused setting came from", () => {
    const error = new IdpSettingRefusedError("--slug: bad", "--slug");

    expect(toZitadelError(error).details).toEqual({
      flag: "--slug",
    });
  });

  it("keeps the settings that do not belong with the provider", () => {
    const error = new IdpSettingsConflictError("bad", ["--issuer"]);

    expect(toZitadelError(error).details).toEqual({
      flags: ["--issuer"],
    });
  });

  it("keeps the settings a custom connection lacks", () => {
    const error = new IdpSettingsMissingError("bad", ["--slug"], "e.g.");

    expect(toZitadelError(error).details).toEqual({
      missing: ["--slug"],
    });
  });

  it("keeps the example a command line to show", () => {
    const error = new IdpSettingsMissingError("bad", ["--slug"], "--provider custom ...");

    expect(error.example).toBe("--provider custom ...");
  });
});

describe("the identity-provider errors' codes", () => {
  it.each([
    ["a refused setting", new IdpSettingRefusedError("bad", "--slug")],
    ["settings that conflict", new IdpSettingsConflictError("bad", ["--issuer"])],
    ["settings that are missing", new IdpSettingsMissingError("bad", ["--slug"], "e.g.")],
    ["an unknown provider", new IdpProviderUnknownError("x", ["google"])],
  ] as const)("reports %s as a validation failure", (_name, error) => {
    expect(error.code).toBe("E_VALIDATION");
  });
});
