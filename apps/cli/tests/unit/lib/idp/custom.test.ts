import { describe, expect, it } from "vitest";

import { ZitadelError } from "../../../../src/lib/errors";
import { customFlagText, selectionFromFlags } from "../../../../src/lib/idp";
import { displayName, issuer, slug } from "../../../helpers/idp-values";

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

/** The connection a command line describes, as the command would see it. */
function custom(values: Parameters<typeof selectionFromFlags>[1], names = flag) {
  const selection = selectionFromFlags("custom", values, names, "e.g.");
  if (selection.kind !== "custom") {
    throw new Error("expected a custom selection");
  }
  return selection.connection;
}

function refusal(run: () => unknown): ZitadelError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ZitadelError);
    return error as ZitadelError;
  }
  throw new Error("expected a refusal");
}

describe("selectionFromFlags for a custom connection", () => {
  it("returns the connection with the default scopes when none were named", () => {
    expect(custom(valid)).toEqual({
      ...valid,
      scopes: ["openid", "profile", "email"],
    });
  });

  it("splits scopes on spaces and commas and drops repeats", () => {
    const connection = custom({ ...valid, scopes: "openid, email  groups,openid" });

    expect(connection.scopes).toEqual(["openid", "email", "groups"]);
  });

  it("trims what was typed", () => {
    const connection = custom({
      slug: " acme-sso ",
      displayName: " Acme SSO ",
      issuer: " https://sso.acme.example ",
    });

    expect(connection).toMatchObject(valid);
  });

  it("names every missing setting at once, with an example to copy", () => {
    const error = refusal(() => selectionFromFlags("custom", {}, flag, "--provider custom ..."));

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
    ["the name custom, which is not a connection", { slug: "custom" }, "built-in provider"],
    ["a blank display name", { displayName: "  " }, "--display-name"],
    ["a display name over 256 characters", { displayName: "x".repeat(257) }, "--display-name"],
    ["an http issuer", { issuer: "http://sso.acme.example" }, "--issuer"],
    ["an issuer that is not a url", { issuer: "sso.acme.example" }, "--issuer"],
    ["scopes without openid", { scopes: "profile email" }, "must include openid"],
    ["scopes that name nothing", { scopes: "," }, "at least one scope"],
  ])("refuses %s", (_name, over, expected) => {
    const error = refusal(() => custom({ ...valid, ...over }));

    expect(error.code).toBe("E_VALIDATION");
    expect(error.message).toContain(expected);
  });

  it("accepts http on localhost, for a stand-in provider", () => {
    expect(custom({ ...valid, issuer: "http://localhost:9100" }).issuer).toBe(
      "http://localhost:9100",
    );
  });

  it("names the flag the way the calling command spells it", () => {
    const setup = {
      provider: "--sso",
      slug: "--sso-slug",
      displayName: "--sso-display-name",
      issuer: "--sso-issuer",
      scopes: "--sso-scopes",
    };

    expect(refusal(() => selectionFromFlags("custom", {}, setup, "e.g.")).message).toContain(
      "--sso-slug, --sso-display-name, --sso-issuer",
    );
  });
});

describe("selectionFromFlags for a catalog provider", () => {
  it("is just the provider, named", () => {
    expect(selectionFromFlags("google", {}, flag, "e.g.")).toEqual({
      kind: "catalog",
      id: "google",
    });
  });

  it("refuses a custom setting the provider would ignore", () => {
    const error = refusal(() =>
      selectionFromFlags("google", { issuer: "https://x.example", scopes: "openid" }, flag, "e.g."),
    );

    expect(error.message).toBe("--issuer, --scopes only applies to a custom connection");
    expect(error.hint).toBe("Add --provider custom, or remove them.");
  });

  it("refuses a name nothing answers to", () => {
    expect(refusal(() => selectionFromFlags("okta", {}, flag, "e.g.")).message).toBe(
      "Unknown provider okta",
    );
  });
});

describe("customFlagText", () => {
  it("restates the connection as flags a shell reads back as the same arguments", () => {
    expect(
      customFlagText(
        {
          slug: slug("acme-sso"),
          displayName: displayName("Acme's SSO; rm -rf"),
          issuer: issuer("https://sso.acme.example"),
          scopes: ["openid", "email"],
        },
        flag,
      ),
    ).toBe(
      "--slug acme-sso --display-name 'Acme'\\''s SSO; rm -rf' --issuer https://sso.acme.example --scopes 'openid email'",
    );
  });
});
