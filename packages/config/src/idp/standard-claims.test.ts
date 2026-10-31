import { describe, expect, it } from "vitest";

import { STANDARD_CLAIMS, standardClaim } from "./standard-claims.js";

describe("the standard claims", () => {
  it("name only the four scopes OpenID Connect defines for them", () => {
    const scopes = new Set(Object.values(STANDARD_CLAIMS).map((claim) => claim.scope));

    expect([...scopes].sort()).toEqual(["address", "email", "phone", "profile"]);
  });

  it("give the email claims to the email scope and the phone claims to the phone scope", () => {
    expect(standardClaim("email")?.scope).toBe("email");
    expect(standardClaim("email_verified")).toEqual({ scope: "email", type: "boolean" });
    expect(standardClaim("phone_number")?.scope).toBe("phone");
    expect(standardClaim("phone_number_verified")).toEqual({ scope: "phone", type: "boolean" });
  });

  it("type the claims that are not strings", () => {
    expect(standardClaim("updated_at")?.type).toBe("number");
    expect(standardClaim("address")?.type).toBe("object");
  });

  it("know nothing of a claim the standard does not define", () => {
    expect(standardClaim("employee_id")).toBeUndefined();
    expect(standardClaim("sub")).toBeUndefined();
  });

  it.each(["constructor", "toString", "__proto__", "hasOwnProperty"])(
    "does not mistake %s for a claim",
    (name) => {
      expect(standardClaim(name)).toBeUndefined();
    },
  );
});
