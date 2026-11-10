import { describe, expect, it } from "vitest";

import {
  CLAIM_SCOPES,
  type ClaimType,
  fits,
  isStandardClaim,
  isStandardScope,
  STANDARD_CLAIMS,
  standardClaim,
} from "@/lib/zitadel/rules/claims";

describe("fits", () => {
  it.each([
    ["string", "string", true],
    ["string", "number", false],
    ["boolean", "boolean", true],
    ["boolean", "string", false],
    ["number", "number", true],
    ["number", "integer", true],
    ["number", "string", false],
    ["object", "object", true],
    ["object", "array", false],
  ] as const satisfies readonly (readonly [ClaimType, string, boolean])[])(
    "says a %s claim fits a property declared %s: %s",
    (claim, declared, expected) => {
      const result = fits(claim, declared);

      expect(result).toBe(expected);
    },
  );
});

describe("isStandardScope", () => {
  it.each([
    ["openid", true],
    ["profile", true],
    ["email", true],
    ["address", true],
    ["phone", true],
    ["offline_access", true],
    ["groups", false],
    ["Email", false],
    ["", false],
  ])("says %j is a standard scope: %s", (scope, expected) => {
    const result = isStandardScope(scope);

    expect(result).toBe(expected);
  });
});

describe("isStandardClaim", () => {
  it.each([
    ["email", true],
    ["email_verified", true],
    ["sub", false],
    ["toString", false],
    ["constructor", false],
  ])("says %j is a standard claim: %s", (claim, expected) => {
    const result = isStandardClaim(claim);

    expect(result).toBe(expected);
  });
});

describe("standardClaim", () => {
  it.each([
    ["email", { scope: "email", type: "string" }],
    ["email_verified", { scope: "email", type: "boolean" }],
    ["updated_at", { scope: "profile", type: "number" }],
    ["address", { scope: "address", type: "object" }],
    ["phone_number", { scope: "phone", type: "string" }],
  ])("gives the scope and type of %j", (claim, expected) => {
    const result = standardClaim(claim);

    expect(result).toEqual(expected);
  });

  it.each([["groups"], ["sub"], ["toString"], [true], [7], [null], [["email"]], [{}], [undefined]])(
    "gives nothing for %j",
    (claim) => {
      const result = standardClaim(claim);

      expect(result).toBeUndefined();
    },
  );

  it("names a scope for every standard claim among the scopes that return claims", () => {
    const scopes = Object.values(STANDARD_CLAIMS).map((claim) => {
      return claim.scope;
    });

    expect(CLAIM_SCOPES).toEqual(expect.arrayContaining([...new Set(scopes)]));
  });
});
