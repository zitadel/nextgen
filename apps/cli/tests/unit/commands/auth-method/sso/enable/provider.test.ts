import { describe, expect, it } from "vitest";

import { ssoProvider } from "@/commands/auth-method/sso/enable/index";
import { ZitadelError } from "@/lib/errors";
import { thrownBy } from "@tests/helpers/thrown-value";

/**
 * A run with nobody to ask.
 */
const SCRIPTED = { interactive: false };

/**
 * A run by a person at a terminal.
 */
const AT_A_TERMINAL = { interactive: true };

describe("ssoProvider", () => {
  it("is a catalog provider by its name", () => {
    const provider = ssoProvider({ provider: "google" }, SCRIPTED);

    expect(provider).toMatchObject({ selection: { kind: "catalog" } });
  });

  it("refuses an unknown provider", () => {
    const error = thrownBy(() => {
      return ssoProvider({ provider: "nope" }, SCRIPTED);
    });

    expect(error).toBeInstanceOf(ZitadelError);
    expect(error).toMatchObject({ code: "E_VALIDATION", message: "Unknown provider nope" });
  });

  it("refuses a custom setting beside a catalog provider", () => {
    const error = thrownBy(() => {
      return ssoProvider({ provider: "google", slug: "acme" }, SCRIPTED);
    });

    expect(error).toBeInstanceOf(ZitadelError);
    expect(error).toMatchObject({ code: "E_VALIDATION" });
  });

  it("holds a script to the flags and names the ones a custom connection lacks", () => {
    const error = thrownBy(() => {
      return ssoProvider({ provider: "custom", slug: "acme" }, SCRIPTED);
    });

    expect(error).toBeInstanceOf(ZitadelError);
    expect(error).toMatchObject({
      code: "E_VALIDATION",
      details: { missing: ["--display-name", "--issuer"] },
    });
  });

  it("leaves a person at a terminal to be asked for the settings they left out", () => {
    const provider = ssoProvider({ provider: "custom", slug: "acme" }, AT_A_TERMINAL);

    expect(provider).toMatchObject({ selection: undefined, values: { slug: "acme" } });
  });
});
