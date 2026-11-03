import { describe, expect, it } from "vitest";

import { ssoProvider } from "../../../../../../src/commands/auth-method/sso/enable/index";

function provider(
  flags: Record<string, string>,
  run: { interactive: boolean } = { interactive: false },
) {
  return () => {
    return ssoProvider(flags, run);
  };
}

describe("ssoProvider", () => {
  it("is a catalog provider by its name", () => {
    expect(provider({ provider: "google" })()).toMatchObject({
      selection: {
        kind: "catalog",
      },
    });
  });

  it("refuses an unknown provider", () => {
    expect(provider({ provider: "nope" })).toThrow(
      expect.objectContaining({
        code: "E_VALIDATION",
        message: "Unknown provider nope",
      }),
    );
  });

  it("refuses a custom setting beside a catalog provider", () => {
    expect(provider({ provider: "google", slug: "acme" })).toThrow(
      expect.objectContaining({
        code: "E_VALIDATION",
      }),
    );
  });

  it("holds a script to the flags and names the ones a custom connection lacks", () => {
    expect(provider({ provider: "custom", slug: "acme" }, { interactive: false })).toThrow(
      expect.objectContaining({
        code: "E_VALIDATION",
        details: {
          missing: ["--display-name", "--issuer"],
        },
      }),
    );
  });

  it("leaves a person at a terminal to be asked for the settings they left out", () => {
    expect(provider({ provider: "custom", slug: "acme" }, { interactive: true })()).toMatchObject({
      selection: undefined,
      values: {
        slug: "acme",
      },
    });
  });
});
