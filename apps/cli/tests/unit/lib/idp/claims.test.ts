import { describe, expect, it } from "vitest";

import { ZitadelError } from "../../../../src/lib/errors";
import {
  applyRequest,
  asksForClaims,
  attributesOf,
  claimedConnection,
  claimNotes,
  claimFlagText,
  claimRequestFromFlags,
  describeMapping,
  fieldLabelFor,
  ENABLE_CLAIM_FLAGS,
  type MappingState,
  NO_CLAIM_REQUEST,
  parseClaimEntry,
  parseScopeList,
  parseVerifiedEntry,
  SETUP_CLAIM_FLAGS,
  seedMapping,
  summariseClaims,
  withClaims,
} from "../../../../src/lib/idp";
import {
  fillable,
  hasFillable,
  mapClaim,
  parseNewAttributeName,
  parseUnusedClaim,
  standardClaimScope,
  standardClaimType,
  unmapped,
  verifyAttribute,
} from "../../../../src/lib/idp/claims";

const SCHEMA = {
  required: ["email"],
  properties: {
    email: { type: "string", "x-unique": "project" },
    givenName: { type: "string" },
    familyName: { type: "string" },
    staffNumber: { type: "integer", "x-unique": "project" },
    score: { type: "number" },
    active: { type: "boolean" },
    tags: { type: "array" },
    nickname: { type: ["string", "null"] },
    phoneNumber: { type: "string" },
    picture: { type: "string" },
  },
};

const attributes = attributesOf(SCHEMA);

/** A connection document as a provider scaffolds one, with the default scopes. */
function document(
  overrides: Record<string, unknown> = {},
  scopes: string[] = ["openid", "profile", "email"],
): Record<string, unknown> {
  return {
    slug: "acme-sso",
    claim_mapping: { email: "email", givenName: "given_name", familyName: "family_name" },
    oidc: { issuer: "https://sso.acme.example", scopes },
    ...overrides,
  };
}

function seeded(scopes?: string[], doc = document({}, scopes)): MappingState {
  return seedMapping(doc, attributes);
}

function value<T>(parsed: { ok: true; value: T } | { ok: false; problem: string }): T {
  if (!parsed.ok) {
    throw new Error(parsed.problem);
  }
  return parsed.value;
}

function problem(parsed: { ok: boolean; problem?: string }): string {
  if (parsed.ok) {
    throw new Error("expected a refusal");
  }
  return parsed.problem ?? "";
}

describe("attributesOf", () => {
  it("reads each property's type, whether it is required and whether it is unique", () => {
    expect(attributes.find((one) => one.name === "email")).toEqual({
      name: "email",
      type: "string",
      required: true,
      unique: true,
    });
    expect(attributes.find((one) => one.name === "givenName")).toEqual({
      name: "givenName",
      type: "string",
      required: false,
      unique: false,
    });
  });

  it("takes the one real type of a nullable property", () => {
    expect(attributes.find((one) => one.name === "nickname")?.type).toBe("string");
  });

  it("leaves a property that is not a scalar without a type", () => {
    expect(attributes.find((one) => one.name === "tags")?.type).toBeUndefined();
  });

  it("is empty for a schema without properties", () => {
    expect(attributesOf({})).toEqual([]);
  });
});

describe("parseClaimEntry", () => {
  it("reads a property and a claim", () => {
    expect(value(parseClaimEntry("contactEmail=mail"))).toEqual({
      attribute: "contactEmail",
      claim: "mail",
    });
  });

  it("reads the type after a trailing colon", () => {
    expect(value(parseClaimEntry("staffNumber=employee_id:integer"))).toEqual({
      attribute: "staffNumber",
      claim: "employee_id",
      type: "integer",
    });
  });

  it("keeps a colon that is part of a namespaced claim name", () => {
    expect(value(parseClaimEntry("roles=https://acme.example/roles"))).toEqual({
      attribute: "roles",
      claim: "https://acme.example/roles",
    });
  });

  it.each(["", "email", "=mail", "email=", "email= "])("refuses %j", (text) => {
    expect(problem(parseClaimEntry(text))).toContain("<property>=<claim>");
  });

  it("refuses a claim name that starts with $, which the connection reserves", () => {
    expect(problem(parseClaimEntry("email=$mail"))).toContain("cannot start with $");
  });

  it("refuses a verifying claim that starts with $", () => {
    expect(problem(parseVerifiedEntry("email=$verified"))).toContain("cannot start with $");
  });

  it.each([
    ["x:Integer", ":Integer is not a type here. Did you mean :integer?"],
    ["employee_id:int", ":int is not a type here. Did you mean :integer?"],
    ["is_active:bool", "Did you mean :boolean?"],
    ["score:float", "Did you mean :number?"],
  ])("refuses the near miss of a type in %s", (claim, message) => {
    expect(problem(parseClaimEntry(`field=${claim}`))).toContain(message);
  });

  it.each([":string", "employee_id:", ":"])(
    "refuses a claim name with a stray colon in %j",
    (claim) => {
      expect(problem(parseClaimEntry(`field=${claim}`))).toContain("start or end with a colon");
    },
  );

  it("keeps a namespaced claim whose last segment is not a type", () => {
    expect(value(parseClaimEntry("roles=urn:acme:roles")).claim).toBe("urn:acme:roles");
  });

  it("refuses a claim name with a space", () => {
    expect(problem(parseClaimEntry("email=the mail"))).toContain("no spaces");
  });
});

describe("parseVerifiedEntry", () => {
  it("reads the claim that verifies a property", () => {
    expect(value(parseVerifiedEntry("contactEmail=email_verified"))).toEqual({
      attribute: "contactEmail",
      source: "email_verified",
    });
  });

  it("reads true as trusting the provider", () => {
    expect(value(parseVerifiedEntry("contactEmail=true"))).toEqual({
      attribute: "contactEmail",
      source: true,
    });
  });

  it.each(["false", "FALSE"])("refuses %s as a verification source", (source) => {
    expect(problem(parseVerifiedEntry(`email=${source}`))).toContain("unverified");
  });

  it("refuses TRUE and says to write true", () => {
    expect(problem(parseVerifiedEntry("email=TRUE"))).toContain("write exactly true");
  });

  it("refuses an entry without a value", () => {
    expect(problem(parseVerifiedEntry("contactEmail"))).toContain("<property>=true");
  });
});

describe("parseScopeList", () => {
  it("splits on spaces and commas and drops duplicates", () => {
    expect(value(parseScopeList("phone, groups  phone"))).toEqual(["phone", "groups"]);
  });

  it("reads nothing as no scopes", () => {
    expect(value(parseScopeList(""))).toEqual([]);
  });
});

describe("standard claims", () => {
  it("knows the type of a claim OpenID Connect defines", () => {
    expect(standardClaimType("email_verified")).toBe("boolean");
    expect(standardClaimType("given_name")).toBe("string");
  });

  it("does not know the type of any other claim", () => {
    expect(standardClaimType("employee_id")).toBeUndefined();
  });

  it("knows the scope that returns a standard claim", () => {
    expect(standardClaimScope("phone_number")).toBe("phone");
    expect(standardClaimScope("employee_id")).toBeUndefined();
  });
});

describe("seedMapping", () => {
  it("keeps what the connection already maps", () => {
    expect(seeded().mapping).toMatchObject({
      email: "email",
      givenName: "given_name",
      familyName: "family_name",
    });
  });

  it("maps a standard claim to the property of the same name when its scope is requested", () => {
    expect(seeded().mapping).toMatchObject({ picture: "picture", nickname: "nickname" });
  });

  it("does not map a standard claim whose scope is not requested", () => {
    expect(seeded(["openid", "profile", "email"]).mapping).not.toHaveProperty("phoneNumber");
  });

  it("maps the claim once its scope is requested", () => {
    expect(seeded(["openid", "profile", "email", "phone"]).mapping.phoneNumber).toBe(
      "phone_number",
    );
  });

  it("does not map a property the claim's type does not fit", () => {
    const state = seedMapping(
      document({ claim_mapping: {} }),
      attributesOf({
        properties: { givenName: { type: "integer" } },
      }),
    );

    expect(state.mapping).toEqual({});
  });

  it("verifies a mapped email by email_verified unless the connection says otherwise", () => {
    expect(seeded().verified).toEqual({ email: "email_verified" });
    expect(seeded(undefined, document({ verified_claims: { email: true } })).verified).toEqual({
      email: true,
    });
  });

  it("never uses one claim for two properties", () => {
    const state = seedMapping(
      document({ claim_mapping: { contactEmail: "email" } }),
      attributesOf({
        properties: { email: { type: "string" }, contactEmail: { type: "string" } },
      }),
    );

    expect(Object.values(state.mapping).filter((claim) => claim === "email")).toHaveLength(1);
  });

  it("starts from the scopes the connection requests", () => {
    expect(seeded().scopes).toEqual(["openid", "profile", "email"]);
  });
});

describe("mapClaim", () => {
  it("maps a claim of the right type to an empty property", () => {
    const next = value(
      mapClaim(seeded(), { attribute: "staffNumber", claim: "employee_id", type: "integer" }),
    );

    expect(next.mapping.staffNumber).toBe("employee_id");
  });

  it("refuses a property the schema does not define and lists the ones it does", () => {
    const message = problem(mapClaim(seeded(), { attribute: "shoeSize", claim: "shoe" }));

    expect(message).toContain("shoeSize is not a property of the user schema");
    expect(message).toContain("staffNumber");
  });

  it("refuses a property that is not a string, number, integer or boolean", () => {
    expect(problem(mapClaim(seeded(), { attribute: "tags", claim: "groups" }))).toContain(
      "cannot be filled from a claim",
    );
  });

  it("replaces what the defaults mapped with the claim it is given", () => {
    const next = value(mapClaim(seeded(), { attribute: "email", claim: "mail" }));

    expect(next.mapping.email).toBe("mail");
  });

  it("drops the verification of the claim it replaced, and says so", () => {
    const next = value(mapClaim(seeded(), { attribute: "email", claim: "mail" }));

    expect(next.verified).not.toHaveProperty("email");
    expect(claimNotes(next).join(" ")).toContain("--verified-claim email=<claim>");
  });

  it("takes the note away once the replaced default is given a verification", () => {
    const replaced = value(mapClaim(seeded(), { attribute: "email", claim: "mail" }));

    const verified = value(verifyAttribute(replaced, { attribute: "email", source: true }));

    expect(claimNotes(verified)).toEqual([]);
  });

  it("keeps the verification when the same claim is named again", () => {
    const next = value(mapClaim(seeded(), { attribute: "email", claim: "email" }));

    expect(next.verified.email).toBe("email_verified");
    expect(claimNotes(next)).toEqual([]);
  });

  it("frees the claim a replaced default held, so another property can take it", () => {
    const next = value(
      applyRequest(
        seedMapping(
          document(),
          attributesOf({
            properties: { email: { type: "string" }, contactEmail: { type: "string" } },
          }),
        ),
        {
          entries: [
            { attribute: "email", claim: "mail" },
            { attribute: "contactEmail", claim: "email" },
          ],
          verified: [],
          scopes: [],
        },
      ),
    );

    expect(next.mapping).toMatchObject({ email: "mail", contactEmail: "email" });
  });

  it("refuses a property an earlier entry of the request already filled", () => {
    expect(
      problem(
        applyRequest(seeded(), {
          entries: [
            { attribute: "givenName", claim: "first_name" },
            { attribute: "givenName", claim: "forename" },
          ],
          verified: [],
          scopes: [],
        }),
      ),
    ).toContain("givenName is already filled from first_name: a property takes one claim.");
  });

  it("refuses a claim that already fills another property", () => {
    const message = problem(mapClaim(seeded(), { attribute: "staffNumber", claim: "email" }));

    expect(message).toContain("email already fills email");
    expect(message).toContain("a claim fills one property");
    expect(message).toContain("map email to another claim first");
  });

  it("refuses a string claim for an integer property and says how to declare it", () => {
    const message = problem(mapClaim(seeded(), { attribute: "staffNumber", claim: "employee_id" }));

    expect(message).toContain("employee_id is a string claim");
    expect(message).toContain("staffNumber (integer) would not hold it");
    expect(message).toContain("staffNumber=employee_id:integer");
  });

  it("refuses a claim declared as a number for an integer property", () => {
    expect(
      problem(
        mapClaim(seeded(), { attribute: "staffNumber", claim: "employee_id", type: "number" }),
      ),
    ).toContain("would not hold it");
  });

  it("holds an integer claim in a number property", () => {
    expect(
      value(mapClaim(seeded(), { attribute: "score", claim: "points", type: "integer" })).mapping
        .score,
    ).toBe("points");
  });

  it("holds a boolean claim only in a boolean property", () => {
    expect(
      value(mapClaim(seeded(), { attribute: "active", claim: "is_active", type: "boolean" }))
        .mapping.active,
    ).toBe("is_active");
    expect(
      problem(mapClaim(seeded(), { attribute: "score", claim: "is_active", type: "boolean" })),
    ).toContain("would not hold it");
  });

  it("refuses a type that contradicts the standard for a standard claim", () => {
    expect(
      problem(mapClaim(seeded(), { attribute: "score", claim: "email_verified", type: "number" })),
    ).toContain("email_verified is a boolean claim in OpenID Connect, not number");
  });
});

describe("fillable", () => {
  it("lists the properties a claim of the type could fill, empty or only filled by default", () => {
    const names = fillable(seeded(), "integer").map((one) => one.name);

    expect(names).toEqual(expect.arrayContaining(["staffNumber", "score"]));
    expect(names).not.toContain("tags");
  });

  it("offers a default's property to a claim of its type", () => {
    expect(fillable(seeded(), "string").map((one) => one.name)).toContain("email");
  });

  it("stops offering a property the request has mapped", () => {
    const next = value(mapClaim(seeded(), { attribute: "email", claim: "mail" }));

    expect(fillable(next, "string").map((one) => one.name)).not.toContain("email");
  });

  it("has nothing to offer once the request has mapped every typed property", () => {
    const only = attributesOf({ properties: { email: { type: "string" } } });
    const next = value(
      mapClaim(seedMapping(document(), only), { attribute: "email", claim: "mail" }),
    );

    expect(hasFillable(next)).toBe(false);
    expect(hasFillable(seeded())).toBe(true);
  });
});

describe("parseUnusedClaim", () => {
  it("refuses a claim that already fills a property", () => {
    expect(problem(parseUnusedClaim(seeded(), "given_name"))).toContain(
      "given_name already fills givenName",
    );
  });

  it("accepts a claim nothing uses", () => {
    expect(value(parseUnusedClaim(seeded(), " employee_id "))).toBe("employee_id");
  });
});

describe("parseNewAttributeName", () => {
  it.each(["employeeNumber", "staff_no", "_x", "a1"])("accepts %s", (name) => {
    expect(value(parseNewAttributeName(name, ["email"]))).toBe(name);
  });

  it("trims what was typed", () => {
    expect(value(parseNewAttributeName(" employeeNumber ", []))).toBe("employeeNumber");
  });

  it("asks for a name when given none", () => {
    expect(problem(parseNewAttributeName("  ", []))).toBe("Enter a name for the attribute.");
  });

  it.each(["staff number", "staff.no", "1abc", "staff-no", "é"])(
    "refuses %j, which is not a plain identifier",
    (name) => {
      expect(problem(parseNewAttributeName(name, []))).toContain("Use letters, digits");
    },
  );

  it("refuses a name that is already an attribute", () => {
    expect(problem(parseNewAttributeName("email", ["email"]))).toBe(
      '"email" is already a user attribute.',
    );
  });
});

describe("mapClaim with create", () => {
  it("adds the attribute, typed to hold the claim, and maps the claim to it", () => {
    const next = value(
      mapClaim(seeded(), {
        attribute: "employeeNumber",
        claim: "employee_id",
        type: "integer",
        create: true,
      }),
    );

    expect(next.mapping.employeeNumber).toBe("employee_id");
    expect(next.created).toEqual([
      { name: "employeeNumber", type: "integer", required: false, unique: false },
    ]);
  });

  it("types a standard claim's attribute by the standard", () => {
    const next = value(
      mapClaim(seeded(), { attribute: "verifiedMail", claim: "email_verified", create: true }),
    );

    expect(next.created[0]?.type).toBe("boolean");
  });

  it("makes the new attribute known to later entries", () => {
    const next = value(
      applyRequest(seeded(), {
        entries: [
          { attribute: "employeeNumber", claim: "employee_id", type: "integer", create: true },
        ],
        verified: [{ attribute: "employeeNumber", source: true }],
        scopes: [],
      }),
    );

    expect(next.verified.employeeNumber).toBe(true);
  });

  it("refuses to create an attribute the schema already has", () => {
    expect(problem(mapClaim(seeded(), { attribute: "score", claim: "points", create: true }))).toBe(
      '"score" is already a user attribute.',
    );
  });

  it("refuses a name that is not a plain identifier", () => {
    expect(
      problem(mapClaim(seeded(), { attribute: "staff number", claim: "n", create: true })),
    ).toContain("Use letters, digits");
  });

  it("still refuses a claim that already fills another attribute", () => {
    expect(
      problem(mapClaim(seeded(), { attribute: "mailCopy", claim: "email", create: true })),
    ).toContain("email already fills email");
  });

  it("is reported by claimedConnection so the commands can write the attribute", () => {
    const parsed = claimedConnection(document(), attributes, {
      entries: [{ attribute: "employeeNumber", claim: "employee_id", create: true }],
      verified: [],
      scopes: [],
    });

    expect(value(parsed).created.map((one) => one.name)).toEqual(["employeeNumber"]);
  });
});

describe("fieldLabelFor", () => {
  it.each([
    ["employeeNumber", "Employee number"],
    ["staff_no", "Staff no"],
    ["email", "Email"],
    ["dateOfBirth", "Date of birth"],
    ["address2Line", "Address2 line"],
    ["x", "X"],
  ])("labels %s as %s, as the login form does", (name, label) => {
    expect(fieldLabelFor(name)).toBe(label);
  });
});

describe("unmapped", () => {
  it("lists only attributes that have no claim yet and could hold the type", () => {
    expect(unmapped(seeded(), "string").map((one) => one.name)).toEqual(
      expect.arrayContaining(["phoneNumber"]),
    );
    expect(unmapped(seeded(), "string").map((one) => one.name)).not.toContain("email");
    expect(unmapped(seeded(), "string").map((one) => one.name)).not.toContain("givenName");
  });
});

describe("verifyAttribute", () => {
  it("records how a mapped property is verified, replacing the default", () => {
    expect(
      value(verifyAttribute(seeded(), { attribute: "email", source: true })).verified.email,
    ).toBe(true);
  });

  it("refuses a property with no claim mapping", () => {
    expect(
      problem(verifyAttribute(seeded(), { attribute: "staffNumber", source: true })),
    ).toContain("has no claim mapping");
  });
});

describe("applyRequest", () => {
  it("applies mappings, then scopes, then verification", () => {
    const next = value(
      applyRequest(seeded(), {
        entries: [{ attribute: "staffNumber", claim: "employee_id", type: "integer" }],
        verified: [{ attribute: "staffNumber", source: "employee_verified" }],
        scopes: ["employee", "profile"],
      }),
    );

    expect(next.mapping.staffNumber).toBe("employee_id");
    expect(next.verified.staffNumber).toBe("employee_verified");
    expect(next.scopes).toEqual(["openid", "profile", "email", "employee"]);
  });

  it("stops at the first entry the guards refuse", () => {
    const message = problem(
      applyRequest(seeded(), {
        entries: [
          { attribute: "staffNumber", claim: "email" },
          { attribute: "score", claim: "points" },
        ],
        verified: [],
        scopes: [],
      }),
    );

    expect(message).toContain("email already fills email");
  });

  it("does not map the same claim twice in one request", () => {
    expect(
      problem(
        applyRequest(seeded(), {
          entries: [
            { attribute: "staffNumber", claim: "employee_id", type: "integer" },
            { attribute: "score", claim: "employee_id", type: "integer" },
          ],
          verified: [],
          scopes: [],
        }),
      ),
    ).toContain("employee_id already fills staffNumber");
  });

  it("verifies a property the same request maps", () => {
    expect(
      applyRequest(seeded(), {
        entries: [{ attribute: "active", claim: "is_active", type: "boolean" }],
        verified: [{ attribute: "active", source: true }],
        scopes: [],
      }).ok,
    ).toBe(true);
  });
});

describe("withClaims", () => {
  it("writes the mapping, the verification and the scopes into the document", () => {
    const next = value(
      applyRequest(seeded(), {
        entries: [{ attribute: "staffNumber", claim: "employee_id", type: "integer" }],
        verified: [],
        scopes: ["employee"],
      }),
    );

    const doc = withClaims(document(), next);

    expect(doc.claim_mapping).toMatchObject({ staffNumber: "employee_id", email: "email" });
    expect(doc.verified_claims).toEqual({ email: "email_verified" });
    expect(doc.oidc).toEqual({
      issuer: "https://sso.acme.example",
      scopes: ["openid", "profile", "email", "employee"],
    });
  });

  it("removes the blocks a provider scaffolded when the state ends with none", () => {
    const replaced = value(mapClaim(seeded(), { attribute: "email", claim: "mail" }));
    const only = { ...replaced, mapping: { email: "mail" }, verified: {} };

    const doc = withClaims(document({ verified_claims: { email: "email_verified" } }), only);

    expect(doc).not.toHaveProperty("verified_claims");
    expect(doc.claim_mapping).toEqual({ email: "mail" });
  });

  it("leaves the keys out when there is nothing to write", () => {
    const empty = seedMapping({ oidc: { scopes: ["openid"] } }, []);

    const doc = withClaims({ slug: "x", oidc: { scopes: ["openid"] } }, empty);

    expect(doc).not.toHaveProperty("claim_mapping");
    expect(doc).not.toHaveProperty("verified_claims");
  });
});

describe("claimedConnection", () => {
  it("returns the document with the defaults and the request applied", () => {
    const parsed = claimedConnection(document(), attributes, {
      entries: [{ attribute: "staffNumber", claim: "employee_id", type: "integer" }],
      verified: [],
      scopes: [],
    });

    expect(value(parsed).document.claim_mapping).toMatchObject({ staffNumber: "employee_id" });
  });

  it("returns the refusal for a request the schema cannot take", () => {
    expect(
      problem(
        claimedConnection(document(), attributes, {
          entries: [{ attribute: "staffNumber", claim: "employee_id" }],
          verified: [],
          scopes: [],
        }),
      ),
    ).toContain("would not hold it");
  });

  it("changes nothing for an empty request beyond the standard defaults", () => {
    expect(
      value(claimedConnection(document(), attributes, NO_CLAIM_REQUEST)).document.claim_mapping,
    ).toMatchObject({
      email: "email",
    });
  });
});

describe("describeMapping", () => {
  it("writes one line per mapping, property first", () => {
    expect(describeMapping(seeded())).toContain("givenName ← given_name");
  });

  it("says how a mapped property is verified", () => {
    expect(describeMapping(seeded())).toContain("email ← email (verified by email_verified)");
    expect(
      describeMapping(value(verifyAttribute(seeded(), { attribute: "email", source: true }))),
    ).toContain("email ← email (the provider is trusted)");
  });
});

describe("summariseClaims", () => {
  it("ends with the scopes the connection asks for", () => {
    expect(summariseClaims(seeded()).at(-1)).toBe("scopes: openid profile email");
  });
});

describe("claimRequestFromFlags", () => {
  it("reads the three flags as one request", () => {
    expect(
      claimRequestFromFlags(
        {
          claim: ["staffNumber=employee_id:integer"],
          verified: ["staffNumber=true"],
          scope: "employee groups",
        },
        ENABLE_CLAIM_FLAGS,
      ),
    ).toEqual({
      entries: [{ attribute: "staffNumber", claim: "employee_id", type: "integer" }],
      verified: [{ attribute: "staffNumber", source: true }],
      scopes: ["employee", "groups"],
    });
  });

  it("names the flag that carried an entry it cannot read", () => {
    const run = () => claimRequestFromFlags({ claim: ["nonsense"] }, SETUP_CLAIM_FLAGS);

    expect(run).toThrow(ZitadelError);
    expect(run).toThrow(/--sso-claim: "nonsense" is not <property>=<claim>/);
  });

  it("is empty when no flag was given", () => {
    expect(asksForClaims(claimRequestFromFlags({}, ENABLE_CLAIM_FLAGS))).toBe(false);
  });
});

describe("claimFlagText", () => {
  it("restates a request as flags, quoting what a shell would split", () => {
    expect(
      claimFlagText(
        {
          entries: [{ attribute: "staffNumber", claim: "employee id", type: "integer" }],
          verified: [{ attribute: "staffNumber", source: true }],
          scopes: ["employee", "groups"],
        },
        SETUP_CLAIM_FLAGS,
      ),
    ).toBe(
      "--sso-claim 'staffNumber=employee id:integer' --sso-verified-claim staffNumber=true --sso-claim-scope 'employee groups'",
    );
  });
});
