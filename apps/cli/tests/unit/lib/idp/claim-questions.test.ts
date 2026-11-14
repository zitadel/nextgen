import { describe, expect, it } from "vitest";

import { claimTable, type MappingState } from "@/lib/idp";

/**
 * A mapping of three attributes: one verified by a claim, one trusted outright
 * and one not verified at all.
 */
const STATE: MappingState = {
  attributes: [],
  mapping: { email: "email", phoneNumber: "phone_number", givenName: "given_name" },
  claimTypes: {},
  verified: { email: "email_verified", phoneNumber: true },
  scopes: [],
  explicit: [],
  unverifiedByReplacing: [],
  created: [],
};

describe("claimTable", () => {
  it("heads the columns with the provider the claims come from", () => {
    expect(claimTable(STATE, "Acme SSO")[0]).toBe(
      'User attribute  Claim from "Acme SSO"  Verified',
    );
  });

  it("says who vouches for each attribute, aligned under the header", () => {
    expect(claimTable(STATE, "Acme SSO").slice(1)).toEqual([
      "email           email                  yes, by email_verified",
      "phoneNumber     phone_number           yes, trusted",
      "givenName       given_name             no",
    ]);
  });

  it("is only the header for a mapping with nothing in it", () => {
    expect(claimTable({ ...STATE, mapping: {} }, "Acme SSO")).toHaveLength(1);
  });
});
