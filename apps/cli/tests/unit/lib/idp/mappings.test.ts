import { describe, expect, it } from "vitest";

import { mappingLines, readMappings, statusLine, stillToConfigure } from "../../../../src/lib/idp";

const CONNECTION = {
  claim_mapping: { email: "mail", givenName: "given_name" },
  verified_claims: { email: "mail_verified", phone: true },
  oidc: { scopes: ["openid", "profile", "email"] },
};

describe("reading a connection's mappings", () => {
  it("reads each attribute with the claim that fills it", () => {
    expect(readMappings(CONNECTION).mapping).toEqual([
      { attribute: "email", claim: "mail" },
      { attribute: "givenName", claim: "given_name" },
    ]);
  });

  it("reads a verification by a claim and one the provider always vouches for", () => {
    expect(readMappings(CONNECTION).verification).toEqual([
      { attribute: "email", claim: "mail_verified" },
      { attribute: "phone", claim: true },
    ]);
  });

  it("reads the scopes", () => {
    expect(readMappings(CONNECTION).scopes).toEqual(["openid", "profile", "email"]);
  });

  it("keeps a claim literally named always apart from trusting the provider", () => {
    const lines = mappingLines(
      { claim_mapping: { email: "email" }, verified_claims: { email: "always", phone: true } },
      "f.json",
    );

    expect(lines).toContain("  email  →  always");
    expect(lines).toContain("  phone  →  (always trusted)");
  });

  it("reads a document with none of them as empty", () => {
    expect(readMappings({})).toEqual({ mapping: [], verification: [], scopes: [] });
  });
});

describe("a connection's mapping as lines", () => {
  const lines = mappingLines(CONNECTION, ".zitadel/idps/acme.json");

  it("puts the attribute on the left of the arrow and the claim on the right", () => {
    expect(lines).toContain("  email      →  mail");
    expect(lines).toContain("  givenName  →  given_name");
  });

  it("keeps what verifies the email apart from what fills it", () => {
    expect(lines.indexOf("  email  →  mail_verified")).toBeGreaterThan(
      lines.indexOf("Verified when (user attribute → claim that must be true):"),
    );
  });

  it("says when a provider is always trusted for an attribute", () => {
    expect(lines).toContain("  phone  →  (always trusted)");
  });

  it("names the file to edit when there is no mapping", () => {
    expect(mappingLines({}, ".zitadel/idps/acme.json")[0]).toContain(".zitadel/idps/acme.json");
  });
});

describe("what is still to configure", () => {
  const steps = (status: "saved" | "applied" | "present"): string[] =>
    stillToConfigure({ status, file: ".zitadel/idps/acme.json", provider: "Acme" });

  it("sends a connection that is only saved to plan and apply", () => {
    expect(steps("saved").join("\n")).toContain("zitadel apply");
  });

  it("does not ask for an apply of one that already reached the server", () => {
    expect(steps("applied").join("\n")).not.toContain("zitadel apply");
  });

  it("always ends on a sign-in, the only test of the mapping", () => {
    expect(steps("applied").at(-1)).toContain("Sign in once");
  });
});

describe("the status line", () => {
  it("tells a saved, an applied and a present connection apart", () => {
    const lines = [statusLine("saved"), statusLine("applied"), statusLine("present")];

    expect(new Set(lines).size).toBe(3);
  });

  it("says a saved connection is not applied", () => {
    expect(statusLine("saved")).toContain("Not applied");
  });

  it("says an applied connection is applied and still untested", () => {
    expect(statusLine("applied")).toBe("Saved and applied. Not tested with a sign-in.");
  });

  it("sends a present connection to plan, since it cannot know whether it was applied", () => {
    expect(statusLine("present")).toContain("zitadel plan");
  });
});

describe("the steps for a present connection", () => {
  it("leave out the apply a saved one needs, and still end on a sign-in", () => {
    const steps = stillToConfigure({
      status: "present",
      file: ".zitadel/idps/acme.json",
      provider: "Acme",
    });

    expect(steps.join("\n")).not.toContain("zitadel apply");
    expect(steps.at(-1)).toContain("Sign in once");
  });
});

describe("reading a malformed connection", () => {
  it("reads a non-string claim, a false verification and non-array scopes as absent", () => {
    expect(
      readMappings({
        claim_mapping: { email: 5, name: "name" },
        verified_claims: { email: false, name: 7 },
        oidc: { scopes: "openid" },
      }),
    ).toEqual({ mapping: [{ attribute: "name", claim: "name" }], verification: [], scopes: [] });
  });

  it("reads a connection that is not shaped like one as empty", () => {
    expect(readMappings({ claim_mapping: [], verified_claims: "x", oidc: null })).toEqual({
      mapping: [],
      verification: [],
      scopes: [],
    });
  });
});
