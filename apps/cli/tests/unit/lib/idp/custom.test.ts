import { describe, expect, it } from "vitest";

import { ZitadelError } from "../../../../src/lib/errors";
import AuthMethodSsoEnable from "../../../../src/commands/auth-method/sso/enable";
import Setup from "../../../../src/commands/setup";
import {
  checkGivenCustomFlags,
  customExample,
  customFlagText,
  ENABLE_FLAG_KEYS,
  flagText,
  SETUP_FLAG_KEYS,
  customFlagValues,
  ENABLE_FLAG_NAMES,
  givenCustomFlags,
  loopbackIssuerWarning,
  SETUP_FLAG_NAMES,
  selectionFromFlags,
} from "../../../../src/lib/idp";
import { displayName, issuer, slug } from "../../../helpers/idp-values";

const flag = ENABLE_FLAG_NAMES;

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

describe("customFlagValues", () => {
  it("reads the settings under the keys the command defines them by", () => {
    expect(
      customFlagValues(
        { slug: "a", "display-name": "A", issuer: "https://a.example" },
        ENABLE_FLAG_KEYS,
      ),
    ).toEqual({
      slug: "a",
      displayName: "A",
      issuer: "https://a.example",
      scopes: undefined,
    });
  });

  it("reads setup's own keys, not enable's", () => {
    expect(customFlagValues({ "sso-slug": "a", "sso-scopes": "openid" }, SETUP_FLAG_KEYS)).toEqual({
      slug: "a",
      displayName: undefined,
      issuer: undefined,
      scopes: "openid",
    });
  });
});

describe("the flag keys and the names built from them", () => {
  it.each([
    ["enable", ENABLE_FLAG_KEYS, ENABLE_FLAG_NAMES],
    ["setup", SETUP_FLAG_KEYS, SETUP_FLAG_NAMES],
  ])("name each %s flag after its key", (_command, keys, names) => {
    expect(names).toEqual(
      Object.fromEntries(Object.entries(keys).map(([setting, key]) => [setting, `--${key}`])),
    );
  });

  it("defines every enable key as a flag of auth-method sso enable", () => {
    expect(Object.keys(AuthMethodSsoEnable.flags)).toEqual(
      expect.arrayContaining(Object.values(ENABLE_FLAG_KEYS)),
    );
  });

  it("defines every setup key as a flag of setup", () => {
    expect(Object.keys(Setup.flags)).toEqual(
      expect.arrayContaining(Object.values(SETUP_FLAG_KEYS)),
    );
  });
});

describe("givenCustomFlags", () => {
  it("names the settings that were given, as the command spells them", () => {
    expect(givenCustomFlags({ slug: "a", scopes: "openid" }, SETUP_FLAG_NAMES)).toEqual([
      "--sso-slug",
      "--sso-scopes",
    ]);
  });
});

describe("checkGivenCustomFlags", () => {
  it("accepts settings that are valid and ignores those that were not given", () => {
    expect(() => checkGivenCustomFlags({ slug: "acme-sso" }, flag)).not.toThrow();
  });

  it.each([
    ["slug", { slug: "Acme" }, "--slug"],
    ["display name", { displayName: "  " }, "--display-name"],
    ["issuer", { issuer: "http://sso.acme.example" }, "--issuer"],
    ["scopes", { scopes: "profile" }, "--scopes"],
  ])("names the flag of an invalid %s", (_setting, values, expected) => {
    const error = refusal(() => checkGivenCustomFlags(values, flag));

    expect(error.message).toContain(expected);
  });

  it("does not insist on the settings it was not given", () => {
    expect(() => checkGivenCustomFlags({}, flag)).not.toThrow();
  });
});

describe("flagText", () => {
  it("writes only the settings that were given, quoted as shell words", () => {
    expect(flagText({ slug: "acme-sso", displayName: "Acme SSO" }, SETUP_FLAG_NAMES)).toBe(
      "--sso-slug acme-sso --sso-display-name 'Acme SSO'",
    );
  });

  it("writes nothing when nothing was given", () => {
    expect(flagText({}, SETUP_FLAG_NAMES)).toBe("");
  });
});

describe("loopbackIssuerWarning", () => {
  it("warns about an issuer on this machine and names the allow list", () => {
    const selection = selectionFromFlags(
      "custom",
      { ...valid, issuer: "http://localhost:9100" },
      flag,
      "e.g.",
    );

    expect(loopbackIssuerWarning(selection)).toContain("NEXTGEN_HTTPCLIENT_ALLOW_LIST");
    expect(loopbackIssuerWarning(selection, "unknown")).toContain("NEXTGEN_HTTPCLIENT_ALLOW_LIST");
  });

  it("is silent on a local server that may fetch from loopback", () => {
    const selection = selectionFromFlags(
      "custom",
      { ...valid, issuer: "http://localhost:9100" },
      flag,
      "e.g.",
    );

    expect(loopbackIssuerWarning(selection, "allowed")).toBeUndefined();
  });

  it("points a container server at the process runtime", () => {
    const selection = selectionFromFlags(
      "custom",
      { ...valid, issuer: "http://localhost:9100" },
      flag,
      "e.g.",
    );

    expect(loopbackIssuerWarning(selection, "container")).toContain("--runtime binary");
  });

  it("says nothing about an issuer elsewhere or about a catalog provider", () => {
    expect(
      loopbackIssuerWarning(selectionFromFlags("custom", valid, flag, "e.g.")),
    ).toBeUndefined();
    expect(loopbackIssuerWarning(selectionFromFlags("google", {}, flag, "e.g."))).toBeUndefined();
  });
});

describe("customExample", () => {
  it("spells the example with the flag names it is given", () => {
    const renamed = {
      provider: "--which",
      slug: "--conn-slug",
      displayName: "--label",
      issuer: "--idp",
      scopes: "--asks",
    };

    expect(customExample(renamed)).toBe(
      "--which custom --conn-slug acme-sso --label 'Acme SSO' --idp https://sso.acme.example",
    );
  });

  it("adds the scopes only when asked", () => {
    expect(customExample(ENABLE_FLAG_NAMES, true)).toContain(
      "--scopes 'openid profile email groups'",
    );
  });

  it("leaves the scopes out otherwise", () => {
    expect(customExample(ENABLE_FLAG_NAMES)).not.toContain("--scopes");
  });

  it("is what auth-method sso enable shows as its examples", () => {
    expect(AuthMethodSsoEnable.examples.join("\n")).toContain(customExample(ENABLE_FLAG_NAMES));
  });
});
