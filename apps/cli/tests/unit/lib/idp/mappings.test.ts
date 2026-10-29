import { describe, expect, it } from "vitest";

import {
  mappingLines,
  readMappings,
  statusLine,
  stillToConfigure,
  unmappedAttributes,
  unmappedLines,
  usedByLines,
} from "../../../../src/lib/idp";

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
      {
        claim_mapping: { email: "email", phone: "phone" },
        verified_claims: { email: "always", phone: true },
      },
      "f.json",
    );

    expect(lines).toContain("  • email comes from the email claim, verified when always is true.");
    expect(lines).toContain("  • phone comes from the phone claim, and is always trusted.");
  });

  it("reads a document with none of them as empty", () => {
    expect(readMappings({})).toEqual({ mapping: [], verification: [], scopes: [] });
  });
});

describe("a connection's mapping as lines", () => {
  const lines = mappingLines(CONNECTION, ".zitadel/idps/acme.json");

  it("says which claim fills each attribute", () => {
    expect(lines).toContain(
      "  • email comes from the mail claim, verified when mail_verified is true.",
    );
    expect(lines).toContain("  • givenName comes from the given_name claim.");
  });

  it("folds what verifies an attribute into the line that fills it", () => {
    expect(lines).toContain(
      "  • email comes from the mail claim, verified when mail_verified is true.",
    );
  });

  it("says when a provider is always trusted for an attribute", () => {
    expect(
      mappingLines(
        { claim_mapping: { phone: "phone_number" }, verified_claims: { phone: true } },
        "f.json",
      ),
    ).toContain("  • phone comes from the phone_number claim, and is always trusted.");
  });

  it("names the file to edit when there is no mapping", () => {
    expect(mappingLines({}, ".zitadel/idps/acme.json")[0]).toContain(".zitadel/idps/acme.json");
  });
});

describe("the attributes a connection does not map", () => {
  it("keeps only the defined attributes that no claim fills, sorted", () => {
    expect(
      unmappedAttributes(CONNECTION, ["email", "givenName", "familyName", "companyName"]),
    ).toEqual(["companyName", "familyName"]);
  });

  it("counts an attribute whose claim is not a string as unmapped", () => {
    expect(unmappedAttributes({ claim_mapping: { email: 5 } }, ["email"])).toEqual(["email"]);
  });

  it("de-duplicates the attributes it is given", () => {
    expect(unmappedAttributes({}, ["companyName", "companyName"])).toEqual(["companyName"]);
  });

  it("reports nothing for a connection no schema defines attributes for", () => {
    expect(unmappedAttributes(CONNECTION, [])).toEqual([]);
  });
});

describe("the unmapped-attributes block", () => {
  it("calls an optional unmapped attribute fine to leave empty", () => {
    const lines = unmappedLines([{ name: "companyName", required: false }]);

    expect(lines).toContain("  • companyName (optional) — fine to leave empty.");
  });

  it("tells a required unmapped attribute to be mapped before a deploy", () => {
    const lines = unmappedLines([{ name: "email", required: true }]);

    expect(lines.join("\n")).toContain(
      "email (required) — a sign-in fills this, so map it before you deploy.",
    );
  });

  it("is empty when everything is mapped", () => {
    expect(unmappedLines([])).toEqual([]);
  });
});

describe("the used-by block", () => {
  it("names the schemas that sign in through the connection", () => {
    expect(usedByLines(["customers", "employees"]).join("\n")).toContain(
      "customers and employees sign in through this connection",
    );
  });

  it("says when no schema uses the connection", () => {
    expect(usedByLines([]).join("\n")).toContain("No user schema");
  });
});

describe("what is still to configure", () => {
  const steps = (status: "saved" | "applied" | "present"): string[] =>
    stillToConfigure({ status, file: ".zitadel/idps/acme.json", provider: "Acme" });

  it("sends a connection that is only saved to deploy", () => {
    expect(steps("saved").join("\n")).toContain("zitadel deploy");
  });

  it("does not ask for a deploy of one that already reached the server", () => {
    expect(steps("applied").join("\n")).not.toContain("zitadel deploy");
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

  it("sends a present connection to deploy, since it cannot know whether it was deployed", () => {
    expect(statusLine("present")).toContain("zitadel deploy");
  });
});

describe("the steps for a present connection", () => {
  it("leave out the deploy a saved one needs, and still end on a sign-in", () => {
    const steps = stillToConfigure({
      status: "present",
      file: ".zitadel/idps/acme.json",
      provider: "Acme",
    });

    expect(steps.join("\n")).not.toContain("zitadel deploy");
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
