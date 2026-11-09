import { describe, expect, it } from "vitest";

import { ZitadelError } from "@/lib/errors";
import { ProviderChoice } from "@/lib/idp";
import { ConfigError, ConflictError, Connection } from "@/lib/zitadel";
import { aFile, anOidcConnection } from "@tests/helpers/config";
import { thrownBy } from "@tests/helpers/thrown-value";

/**
 * A run with nobody to ask.
 */
const SCRIPTED = { interactive: false };

/**
 * A run by a person at a terminal.
 */
const AT_A_TERMINAL = { interactive: true };

/**
 * The file the `acme-sso` connection is read from.
 */
const ACME_SSO_FILE = ".zitadel/idps/acme-sso.json";

/**
 * A custom run at a terminal that names nothing, so every setting is read
 * from the file or asked for.
 */
const UNDESCRIBED = ProviderChoice.fromFlags({ provider: "custom" }, AT_A_TERMINAL);

describe("ProviderChoice.fromFlags", () => {
  it("is a catalog provider by its name", () => {
    const provider = ProviderChoice.fromFlags({ provider: "google" }, SCRIPTED);

    expect(provider).toMatchObject({ selection: { kind: "catalog" } });
  });

  it("refuses an unknown provider", () => {
    const error = thrownBy(() => {
      return ProviderChoice.fromFlags({ provider: "nope" }, SCRIPTED);
    });

    expect(error).toBeInstanceOf(ZitadelError);
    expect(error).toMatchObject({ code: "E_VALIDATION", message: "Unknown provider nope" });
  });

  it("refuses a custom setting beside a catalog provider", () => {
    const error = thrownBy(() => {
      return ProviderChoice.fromFlags({ provider: "google", slug: "acme" }, SCRIPTED);
    });

    expect(error).toBeInstanceOf(ZitadelError);
    expect(error).toMatchObject({ code: "E_VALIDATION" });
  });

  it("holds a script to the flags and names the ones a custom connection lacks", () => {
    const error = thrownBy(() => {
      return ProviderChoice.fromFlags({ provider: "custom", slug: "acme" }, SCRIPTED);
    });

    expect(error).toBeInstanceOf(ZitadelError);
    expect(error).toMatchObject({
      code: "E_VALIDATION",
      details: { missing: ["--display-name", "--issuer"] },
    });
  });

  it("leaves a person at a terminal to be asked for the settings they left out", () => {
    const provider = ProviderChoice.fromFlags({ provider: "custom", slug: "acme" }, AT_A_TERMINAL);

    expect(provider).toMatchObject({ selection: undefined, values: { slug: "acme" } });
  });
});

describe("ProviderChoice.readStoredSettings", () => {
  it("is the display name and issuer the file holds", () => {
    const acme = Connection.of(
      aFile("connections", "acme-sso.json", anOidcConnection({ slug: "acme-sso" })),
    );

    const stored = UNDESCRIBED.readStoredSettings(acme);

    expect(stored).toEqual({ displayName: "Acme", issuer: "https://sso.acme.example" });
  });

  describe("when the run was given a setting", () => {
    it("leaves it out without reading the file's", () => {
      const acme = Connection.of(
        aFile(
          "connections",
          "acme-sso.json",
          anOidcConnection({ slug: "acme-sso", display_name: "   " }),
        ),
      );
      const choice = ProviderChoice.fromFlags(
        { provider: "custom", displayName: "Acme SSO" },
        AT_A_TERMINAL,
      );

      const stored = choice.readStoredSettings(acme);

      expect(stored).toEqual({ displayName: undefined, issuer: "https://sso.acme.example" });
    });
  });

  describe("when a stored setting cannot be used", () => {
    it("refuses a display name a typed answer could not be, naming the file", () => {
      const acme = Connection.of(
        aFile(
          "connections",
          "acme-sso.json",
          anOidcConnection({ slug: "acme-sso", display_name: "   " }),
        ),
      );

      const error = thrownBy(() => {
        return UNDESCRIBED.readStoredSettings(acme);
      });

      expect(error).toBeInstanceOf(ConfigError);
      expect(error).toMatchObject({
        message: expect.stringContaining(
          `${ACME_SSO_FILE} holds a display name that cannot be used: `,
        ),
        hint: "Fix it in that file, or choose another slug.",
        details: { file: ACME_SSO_FILE, slug: "acme-sso" },
      });
    });
  });

  describe("when the file has no issuer", () => {
    it("refuses it as no OIDC connection, whatever issuer was given", () => {
      const acme = Connection.of(
        aFile("connections", "acme-sso.json", {
          slug: "acme-sso",
          protocol: "oidc",
          display_name: "Acme",
        }),
      );
      const choice = ProviderChoice.fromFlags(
        { provider: "custom", issuer: "https://sso.acme.example" },
        AT_A_TERMINAL,
      );

      const error = thrownBy(() => {
        return choice.readStoredSettings(acme);
      });

      expect(error).toBeInstanceOf(ConflictError);
      expect(error).toMatchObject({
        message: `${ACME_SSO_FILE} is already named acme-sso and is not an OIDC connection`,
        hint: "Fix the file, or choose another slug, then run the command again.",
      });
    });
  });
});
