import { describe, expect, it } from "vitest";

import { mappingNotes } from "../../../../src/lib/idp/mapping-notes";

const FILE = ".zitadel/idps/acme-sso.json";

describe("mappingNotes", () => {
  it("lists each mapping as attribute then claim, and says what verifies a value", () => {
    expect(
      mappingNotes({
        file: FILE,
        provider: "Acme SSO",
        connection: {
          claim_mapping: { email: "email", givenName: "given_name" },
          verified_claims: { email: "email_verified" },
        },
      }),
    ).toEqual([
      "Claim mappings in .zitadel/idps/acme-sso.json. Each line is an attribute of your user schema, then the claim Acme SSO must return for it:",
      "  email ← email",
      "  givenName ← given_name",
      "email is treated as verified only when Acme SSO says so in the email_verified claim.",
      "Mapping a value does not by itself mark it verified. Edit the mappings in that file if your provider returns other claims.",
    ]);
  });

  it("says a value that is always verified is treated as verified", () => {
    const notes = mappingNotes({
      file: FILE,
      provider: "Acme SSO",
      connection: { claim_mapping: { email: "email" }, verified_claims: { email: true } },
    });

    expect(notes).toContain("email is treated as verified.");
  });

  it("says nothing for a connection with no mapping", () => {
    expect(mappingNotes({ file: FILE, provider: "Acme SSO", connection: {} })).toEqual([]);
  });
});
