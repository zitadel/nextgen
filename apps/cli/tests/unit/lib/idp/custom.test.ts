import { describe, expect, it } from "vitest";

import { ZitadelError } from "../../../../src/lib/errors";
import {
  customConnectionFromFlags,
  customFlagText,
  refuseCustomFlagsWithoutCustom,
} from "../../../../src/lib/idp";

const flag = {
  provider: "--provider",
  slug: "--slug",
  displayName: "--display-name",
  issuer: "--issuer",
  scopes: "--scopes",
};

const valid = {
  slug: "acme-sso",
  displayName: "Acme SSO",
  issuer: "https://sso.acme.example",
};

function refusal(run: () => unknown): ZitadelError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ZitadelError);
    return error as ZitadelError;
  }
  throw new Error("expected a refusal");
}

describe("customConnectionFromFlags", () => {
  it("returns the connection with the default scopes when none were named", () => {
    expect(customConnectionFromFlags(valid, flag, "e.g.")).toEqual({
      ...valid,
      scopes: ["openid", "profile", "email"],
    });
  });

  it("splits scopes on spaces and commas and drops repeats", () => {
    const connection = customConnectionFromFlags(
      { ...valid, scopes: "openid, email  groups,openid" },
      flag,
      "e.g.",
    );

    expect(connection.scopes).toEqual(["openid", "email", "groups"]);
  });

  it("trims what was typed", () => {
    const connection = customConnectionFromFlags(
      { slug: " acme-sso ", displayName: " Acme SSO ", issuer: " https://sso.acme.example " },
      flag,
      "e.g.",
    );

    expect(connection).toMatchObject(valid);
  });

  it("names every missing setting at once, with an example to copy", () => {
    const error = refusal(() => customConnectionFromFlags({}, flag, "--provider custom ..."));

    expect(error.code).toBe("E_VALIDATION");
    expect(error.message).toBe("A custom connection needs --slug, --display-name, --issuer");
    expect(error.hint).toContain("--provider custom ...");
  });

  it.each([
    ["an uppercase slug", { slug: "Acme" }, "--slug"],
    ["a slug starting with a dash", { slug: "-acme" }, "--slug"],
    ["a slug with a space", { slug: "acme sso" }, "--slug"],
    ["a slug over 64 characters", { slug: "a".repeat(65) }, "--slug"],
    ["the name of a built-in provider", { slug: "google" }, "built-in provider"],
    ["a blank display name", { displayName: "  " }, "--display-name"],
    ["a display name over 256 characters", { displayName: "x".repeat(257) }, "--display-name"],
    ["an http issuer", { issuer: "http://sso.acme.example" }, "--issuer"],
    ["an issuer that is not a url", { issuer: "sso.acme.example" }, "--issuer"],
    ["scopes without openid", { scopes: "profile email" }, "must include openid"],
  ])("refuses %s", (_name, over, expected) => {
    const error = refusal(() => customConnectionFromFlags({ ...valid, ...over }, flag, "e.g."));

    expect(error.code).toBe("E_VALIDATION");
    expect(error.message).toContain(expected);
  });

  it("accepts http on localhost, for a stand-in provider", () => {
    expect(
      customConnectionFromFlags({ ...valid, issuer: "http://localhost:9100" }, flag, "e.g.").issuer,
    ).toBe("http://localhost:9100");
  });

  it("names the flag the way the calling command spells it", () => {
    const setup = {
      provider: "--sso",
      slug: "--sso-slug",
      displayName: "--sso-display-name",
      issuer: "--sso-issuer",
      scopes: "--sso-scopes",
    };

    expect(refusal(() => customConnectionFromFlags({}, setup, "e.g.")).message).toContain(
      "--sso-slug, --sso-display-name, --sso-issuer",
    );
  });
});

describe("refuseCustomFlagsWithoutCustom", () => {
  it("lets a custom provider carry the flags", () => {
    expect(() => refuseCustomFlagsWithoutCustom(valid, flag, "custom")).not.toThrow();
  });

  it("lets a catalog provider carry none", () => {
    expect(() => refuseCustomFlagsWithoutCustom({}, flag, "google")).not.toThrow();
  });

  it("refuses a flag that a catalog provider would ignore", () => {
    const error = refusal(() =>
      refuseCustomFlagsWithoutCustom(
        { issuer: "https://x.example", scopes: "openid" },
        flag,
        "google",
      ),
    );

    expect(error.message).toBe("--issuer, --scopes only applies to a custom connection");
    expect(error.hint).toBe("Add --provider custom, or remove them.");
  });
});

describe("customFlagText", () => {
  it("restates the connection as flags a shell reads back as the same arguments", () => {
    expect(
      customFlagText(
        {
          slug: "acme-sso",
          displayName: "Acme's SSO; rm -rf",
          issuer: "https://sso.acme.example",
          scopes: ["openid", "email"],
        },
        flag,
      ),
    ).toBe(
      "--slug acme-sso --display-name 'Acme'\\''s SSO; rm -rf' --issuer https://sso.acme.example --scopes 'openid email'",
    );
  });
});
