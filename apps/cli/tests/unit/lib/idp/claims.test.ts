import { describe, expect, it } from "vitest";

import { ZitadelError } from "@/lib/errors";
import {
  applyRequest,
  asksForClaims,
  attributesOf,
  claimFlagTexts,
  claimNotes,
  claimRequestFromFlags,
  claimsOrRefuse,
  fieldLabelFor,
  type MappingState,
  mapClaim,
  parseClaimEntry,
  parseNewAttributeName,
  parseScopeList,
  parseUnusedClaim,
  parseVerifiedEntry,
  seedMapping,
  standardClaimScope,
  standardClaimType,
  unmapped,
  verifyAttribute,
} from "@/lib/idp";
import { Connection, UserSchema } from "@/lib/zitadel";
import { aFile, anOidcConnection, aUserSchema } from "@tests/helpers/config";
import { thrownBy } from "@tests/helpers/thrown-value";

/**
 * The verification flag a note about a replaced default names.
 */
const VERIFIED_FLAG = "--verified-claim";

/**
 * The scopes a provider is scaffolded with.
 */
const DEFAULT_SCOPES = ["openid", "profile", "email"];

/**
 * The properties of the schema the mappings are read against.
 */
const PROPERTIES = {
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
};

/**
 * A user schema holding the given properties, in which only `email` is required.
 *
 * @param properties - The properties, by name.
 * @returns The schema.
 */
function aSchemaOf(properties: Record<string, object>): UserSchema {
  return UserSchema.create(
    aFile("schemas", "default-human-user.json", aUserSchema({ required: ["email"], properties })),
  );
}

/**
 * A connection as a provider scaffolds one.
 *
 * @param overrides - Top-level keys to set in place of the defaults.
 * @param scopes - The scopes it requests.
 * @returns The connection.
 */
function aConnection(
  overrides: Record<string, object> = {},
  scopes: readonly string[] = DEFAULT_SCOPES,
): Connection {
  return Connection.create(
    aFile(
      "connections",
      "acme-sso.json",
      anOidcConnection({
        slug: "acme-sso",
        claim_mapping: { email: "email", givenName: "given_name", familyName: "family_name" },
        oidc: { scopes: [...scopes] },
        ...overrides,
      }),
    ),
  );
}

/**
 * The mapping a connection starts from, read against the schema of {@link PROPERTIES}.
 *
 * @param scopes - The scopes the connection requests.
 * @param connection - The connection, when it is not the default one.
 * @returns The mapping.
 */
function seeded(
  scopes?: readonly string[],
  connection: Connection = aConnection({}, scopes),
): MappingState {
  return seedMapping(connection, aSchemaOf(PROPERTIES));
}

/**
 * What a parse made.
 *
 * @param parsed - The outcome.
 * @returns The value.
 * @throws When the text did not parse.
 */
function value<T>(parsed: { ok: true; value: T } | { ok: false; problem: string }): T {
  if (!parsed.ok) {
    throw new Error(parsed.problem);
  }
  return parsed.value;
}

/**
 * What a parse refused with.
 *
 * @param parsed - The outcome.
 * @returns The problem.
 * @throws When the text parsed.
 */
function problem(parsed: { ok: boolean; problem?: string }): string {
  if (parsed.ok) {
    throw new Error("expected a refusal");
  }
  return parsed.problem ?? "";
}

/**
 * The names of properties.
 *
 * @param attributes - The properties.
 * @returns Their names.
 */
function namesOf(attributes: ReadonlyArray<{ readonly name: string }>): readonly string[] {
  return attributes.map((attribute) => {
    return attribute.name;
  });
}

describe("attributesOf", () => {
  const attributes = attributesOf(aSchemaOf(PROPERTIES));
  const named = (name: string) => {
    return attributes.find((one) => {
      return one.name === name;
    });
  };

  it("reads a property that is required and unique", () => {
    expect(named("email")).toEqual({
      name: "email",
      type: "string",
      required: true,
      unique: true,
    });
  });

  it("reads a property that is neither", () => {
    expect(named("givenName")).toEqual({
      name: "givenName",
      type: "string",
      required: false,
      unique: false,
    });
  });

  it("takes the one real type of a nullable property", () => {
    expect(named("nickname")?.type).toBe("string");
  });

  it("leaves a property that is not a scalar without a type", () => {
    expect(named("tags")?.type).toBeUndefined();
  });

  it("is empty for a schema without properties", () => {
    expect(attributesOf(aSchemaOf({}))).toEqual([]);
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
    expect([standardClaimType("email_verified"), standardClaimType("given_name")]).toEqual([
      "boolean",
      "string",
    ]);
  });

  it("does not know the type of any other claim", () => {
    expect(standardClaimType("employee_id")).toBeUndefined();
  });

  it("does not hold an object claim as a scalar", () => {
    expect(standardClaimType("address")).toBeUndefined();
  });

  it("knows the scope that returns a standard claim", () => {
    expect([standardClaimScope("phone_number"), standardClaimScope("employee_id")]).toEqual([
      "phone",
      undefined,
    ]);
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
    expect(seeded(DEFAULT_SCOPES).mapping).not.toHaveProperty("phoneNumber");
  });

  it("maps the claim once its scope is requested", () => {
    expect(seeded([...DEFAULT_SCOPES, "phone"]).mapping.phoneNumber).toBe("phone_number");
  });

  it("does not map a property the claim's type does not fit", () => {
    const state = seedMapping(
      aConnection({ claim_mapping: {} }),
      aSchemaOf({ givenName: { type: "integer" } }),
    );

    expect(state.mapping).toEqual({});
  });

  it("verifies a mapped email by email_verified", () => {
    expect(seeded().verified).toEqual({ email: "email_verified" });
  });

  it("keeps how the connection says a property is verified", () => {
    const connection = aConnection({ verified_claims: { email: true } });

    expect(seeded(undefined, connection).verified).toEqual({ email: true });
  });

  it("never uses one claim for two properties", () => {
    const state = seedMapping(
      aConnection({ claim_mapping: { contactEmail: "email" } }),
      aSchemaOf({ email: { type: "string" }, contactEmail: { type: "string" } }),
    );

    expect(
      Object.values(state.mapping).filter((claim) => {
        return claim === "email";
      }),
    ).toHaveLength(1);
  });

  it("starts from the scopes the connection requests", () => {
    expect(seeded().scopes).toEqual(DEFAULT_SCOPES);
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

  it("drops the verification of the claim it replaced", () => {
    const next = value(mapClaim(seeded(), { attribute: "email", claim: "mail" }));

    expect(next.verified).not.toHaveProperty("email");
  });

  it("says that the replaced default is no longer verified", () => {
    const next = value(mapClaim(seeded(), { attribute: "email", claim: "mail" }));

    expect(claimNotes(next, VERIFIED_FLAG).join(" ")).toContain("--verified-claim email=<claim>");
  });

  it("takes the note away once the replaced default is given a verification", () => {
    const replaced = value(mapClaim(seeded(), { attribute: "email", claim: "mail" }));

    const verified = value(verifyAttribute(replaced, { attribute: "email", source: true }));

    expect(claimNotes(verified, VERIFIED_FLAG)).toEqual([]);
  });

  it("keeps the verification when the same claim is named again", () => {
    const next = value(mapClaim(seeded(), { attribute: "email", claim: "email" }));

    expect([next.verified.email, claimNotes(next, VERIFIED_FLAG)]).toEqual(["email_verified", []]);
  });

  it("frees the claim a replaced default held, so another property can take it", () => {
    const next = value(
      applyRequest(
        seedMapping(
          aConnection(),
          aSchemaOf({ email: { type: "string" }, contactEmail: { type: "string" } }),
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
    const parsed = applyRequest(seeded(), {
      entries: [
        { attribute: "givenName", claim: "first_name" },
        { attribute: "givenName", claim: "forename" },
      ],
      verified: [],
      scopes: [],
    });

    expect(problem(parsed)).toContain(
      "givenName is already filled from first_name: a property takes one claim.",
    );
  });

  it("refuses a claim that already fills another property", () => {
    const message = problem(mapClaim(seeded(), { attribute: "staffNumber", claim: "email" }));

    expect(message).toContain(
      "email already fills email: a claim fills one property. To move it, map email to another claim first",
    );
  });

  it("refuses a string claim for an integer property", () => {
    const message = problem(mapClaim(seeded(), { attribute: "staffNumber", claim: "employee_id" }));

    expect(message).toContain("employee_id is a string claim");
    expect(message).toContain("staffNumber (integer) would not hold it");
  });

  it("says how to declare the type of a claim an integer property would not hold", () => {
    const message = problem(mapClaim(seeded(), { attribute: "staffNumber", claim: "employee_id" }));

    expect(message).toContain("staffNumber=employee_id:integer");
  });

  it("refuses a claim declared as a number for an integer property", () => {
    const parsed = mapClaim(seeded(), {
      attribute: "staffNumber",
      claim: "employee_id",
      type: "number",
    });

    expect(problem(parsed)).toContain("would not hold it");
  });

  it("holds an integer claim in a number property", () => {
    const next = value(
      mapClaim(seeded(), { attribute: "score", claim: "points", type: "integer" }),
    );

    expect(next.mapping.score).toBe("points");
  });

  it("holds a boolean claim in a boolean property", () => {
    const next = value(
      mapClaim(seeded(), { attribute: "active", claim: "is_active", type: "boolean" }),
    );

    expect(next.mapping.active).toBe("is_active");
  });

  it("holds a boolean claim in no other property", () => {
    const parsed = mapClaim(seeded(), { attribute: "score", claim: "is_active", type: "boolean" });

    expect(problem(parsed)).toContain("would not hold it");
  });

  it("refuses a type that contradicts the standard for a standard claim", () => {
    const parsed = mapClaim(seeded(), {
      attribute: "score",
      claim: "email_verified",
      type: "number",
    });

    expect(problem(parsed)).toContain(
      "email_verified is a boolean claim in OpenID Connect, not number",
    );
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

    expect([next.mapping.employeeNumber, next.created]).toEqual([
      "employee_id",
      [{ name: "employeeNumber", type: "integer", required: false, unique: false }],
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
    const parsed = mapClaim(seeded(), { attribute: "score", claim: "points", create: true });

    expect(problem(parsed)).toBe('"score" is already a user attribute.');
  });

  it("refuses a name that is not a plain identifier", () => {
    const parsed = mapClaim(seeded(), { attribute: "staff number", claim: "n", create: true });

    expect(problem(parsed)).toContain("Use letters, digits");
  });

  it("still refuses a claim that already fills another attribute", () => {
    const parsed = mapClaim(seeded(), { attribute: "mailCopy", claim: "email", create: true });

    expect(problem(parsed)).toContain("email already fills email");
  });

  it("is reported in the state so the commands can write the attribute", () => {
    const parsed = applyRequest(seeded(), {
      entries: [{ attribute: "employeeNumber", claim: "employee_id", create: true }],
      verified: [],
      scopes: [],
    });

    expect(namesOf(value(parsed).created)).toEqual(["employeeNumber"]);
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
  it("lists an attribute that has no claim yet and could hold the type", () => {
    expect(namesOf(unmapped(seeded(), "string"))).toContain("phoneNumber");
  });

  it("leaves out an attribute a default fills", () => {
    expect(namesOf(unmapped(seeded(), "string"))).not.toContain("givenName");
  });

  it("leaves out an attribute that could not hold the type", () => {
    expect(namesOf(unmapped(seeded(), "string"))).not.toContain("staffNumber");
  });
});

describe("verifyAttribute", () => {
  it("records how a mapped property is verified, replacing the default", () => {
    const verified = value(verifyAttribute(seeded(), { attribute: "email", source: true }));

    expect(verified.verified.email).toBe(true);
  });

  it("refuses a property with no claim mapping", () => {
    const parsed = verifyAttribute(seeded(), { attribute: "staffNumber", source: true });

    expect(problem(parsed)).toContain("has no claim mapping");
  });
});

describe("applyRequest", () => {
  it("maps what is asked for", () => {
    const next = value(
      applyRequest(seeded(), {
        entries: [{ attribute: "staffNumber", claim: "employee_id", type: "integer" }],
        verified: [],
        scopes: [],
      }),
    );

    expect(next.mapping.staffNumber).toBe("employee_id");
  });

  it("adds the scopes to the ones the connection requests", () => {
    const next = value(
      applyRequest(seeded(), { entries: [], verified: [], scopes: ["employee", "profile"] }),
    );

    expect(next.scopes).toEqual([...DEFAULT_SCOPES, "employee"]);
  });

  it("verifies a property the same request maps", () => {
    const next = value(
      applyRequest(seeded(), {
        entries: [{ attribute: "staffNumber", claim: "employee_id", type: "integer" }],
        verified: [{ attribute: "staffNumber", source: "employee_verified" }],
        scopes: [],
      }),
    );

    expect(next.verified.staffNumber).toBe("employee_verified");
  });

  it("stops at the first entry the guards refuse", () => {
    const parsed = applyRequest(seeded(), {
      entries: [
        { attribute: "staffNumber", claim: "email" },
        { attribute: "score", claim: "points" },
      ],
      verified: [],
      scopes: [],
    });

    expect(problem(parsed)).toContain("email already fills email");
  });

  it("does not map the same claim twice in one request", () => {
    const parsed = applyRequest(seeded(), {
      entries: [
        { attribute: "staffNumber", claim: "employee_id", type: "integer" },
        { attribute: "score", claim: "employee_id", type: "integer" },
      ],
      verified: [],
      scopes: [],
    });

    expect(problem(parsed)).toContain("employee_id already fills staffNumber");
  });

  it("refuses to verify a property it does not map", () => {
    const parsed = applyRequest(seeded(), {
      entries: [],
      verified: [{ attribute: "staffNumber", source: true }],
      scopes: [],
    });

    expect(problem(parsed)).toContain("has no claim mapping");
  });
});

describe("claimsOrRefuse", () => {
  it("answers what parsed", () => {
    expect(claimsOrRefuse({ ok: true, value: 7 })).toBe(7);
  });

  it("refuses with E_VALIDATION saying what to fix", () => {
    const error = thrownBy(() => {
      return claimsOrRefuse({ ok: false, problem: "nothing fits" });
    });

    expect(error).toMatchObject({ code: "E_VALIDATION", message: "nothing fits" });
    expect(error).toBeInstanceOf(ZitadelError);
  });
});

describe("claimRequestFromFlags", () => {
  it("reads the three flags as one request", () => {
    expect(
      claimRequestFromFlags({
        claim: ["staffNumber=employee_id:integer"],
        verified: ["staffNumber=true"],
        scope: "employee groups",
      }),
    ).toEqual({
      entries: [{ attribute: "staffNumber", claim: "employee_id", type: "integer" }],
      verified: [{ attribute: "staffNumber", source: true }],
      scopes: ["employee", "groups"],
    });
  });

  it("is empty when no flag was given", () => {
    expect(asksForClaims(claimRequestFromFlags({}))).toBe(false);
  });
});

describe("claimFlagTexts", () => {
  it("restates a request as the flags that carry it", () => {
    expect(
      claimFlagTexts({
        entries: [{ attribute: "staffNumber", claim: "employee_id", type: "integer" }],
        verified: [{ attribute: "staffNumber", source: true }],
        scopes: ["employee", "groups"],
      }),
    ).toEqual({
      claim: ["staffNumber=employee_id:integer"],
      verifiedClaim: ["staffNumber=true"],
      claimScope: "employee groups",
    });
  });

  it("leaves out a flag the request does not use", () => {
    expect(claimFlagTexts({ entries: [], verified: [], scopes: [] })).toEqual({
      claim: undefined,
      verifiedClaim: undefined,
      claimScope: undefined,
    });
  });
});
