import { CreateIdpBody, CreateUserBody } from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  describeBody,
  documentSchemaOf,
  mergeDocuments,
  readAssignment,
  readAssignments,
} from "../../../../../src/lib/oclif/crud";
import { fragmentOf } from "../../../../../src/lib/oclif/crud/assign";
import type { ZodLike } from "../../../../../src/lib/oclif/crud/zod";

const connection = documentSchemaOf(CreateIdpBody, "idp");
const connectionFields = describeBody(CreateIdpBody, { root: "idp" });
const user = documentSchemaOf(CreateUserBody);
const userFields = describeBody(CreateUserBody);
const set = (raw: string) => readAssignment(raw, connection, connectionFields);

describe("readAssignment", () => {
  it("assigns text to a path the schema types as a string", () => {
    expect(set("oidc.issuer=https://sso.acme.example")).toMatchObject({
      name: "oidc.issuer",
      path: ["oidc", "issuer"],
      value: "https://sso.acme.example",
    });
  });

  it("reads `=` as the type the schema declares", () => {
    expect(set("oidc.pkce_enabled=false").value).toBe(false);
  });

  it("reads `:=` as JSON", () => {
    expect(set('oidc.scopes:=["openid","email"]').value).toEqual(["openid", "email"]);
    expect(set("oidc.static_authorize_parameters:=null").value).toBeNull();
  });

  it("keeps `=` inside a value", () => {
    expect(set("display_name=a=b").value).toBe("a=b");
  });

  it("takes any key below an open record", () => {
    expect(set("claim_mapping.email=email").path).toEqual(["claim_mapping", "email"]);
    expect(readAssignment("attributes.address.city=Zurich", user, userFields)).toMatchObject({
      path: ["attributes", "address", "city"],
      value: "Zurich",
    });
  });

  it("refuses a path the schema does not have, naming the fields near it", () => {
    expect(() => set("oidc.isuer=https://x")).toThrowError(
      expect.objectContaining({
        code: "E_VALIDATION",
        message: "--set oidc.isuer names no field of this body",
        hint: expect.stringContaining("oidc.issuer"),
      }),
    );
  });

  it("refuses a path that runs on past a value with no fields", () => {
    expect(() => set("slug.first=x")).toThrowError(
      expect.objectContaining({ message: "--set slug.first names no field of this body" }),
    );
  });

  it("asks for JSON where the path names a list or an object", () => {
    expect(() => set("oidc.scopes=openid")).toThrowError(
      expect.objectContaining({
        message: "--set oidc.scopes names a list, which takes JSON",
        hint: expect.stringContaining("--oidc-scopes"),
      }),
    );
    expect(() => set("oidc=x")).toThrowError(
      expect.objectContaining({ message: "--set oidc names an object, which takes JSON" }),
    );
  });

  it("refuses a value that does not fit the declared type", () => {
    expect(() => set("oidc.pkce_enabled=maybe")).toThrowError(
      expect.objectContaining({
        message: '--set oidc.pkce_enabled expects true or false, got "maybe"',
      }),
    );
  });

  it.each([
    ["nonsense", 'Invalid --set "nonsense"'],
    ["=x", 'Invalid --set "=x"'],
    ["oidc..issuer=x", 'Invalid --set path "oidc..issuer"'],
    [".slug=x", 'Invalid --set path ".slug"'],
    ["slug.=x", 'Invalid --set path "slug."'],
  ])("refuses the malformed entry %s", (raw, message) => {
    expect(() => set(raw)).toThrowError(
      expect.objectContaining({ code: "E_VALIDATION", message, hint: expect.any(String) }),
    );
  });

  it("splits at the first `=`, so a plain value may contain `:=`", () => {
    expect(set("display_name=b:=c")).toMatchObject({ path: ["display_name"], value: "b:=c" });
    expect(set('oidc.scopes:=["a=b"]').value).toEqual(["a=b"]);
  });

  it("refuses a path that runs into a list, which is set whole", () => {
    expect(() => set("oidc.scopes.0=openid")).toThrowError(
      expect.objectContaining({
        message: "--set oidc.scopes.0 names no field of this body",
        hint: expect.stringContaining("oidc.scopes"),
      }),
    );
  });

  it.each([
    ["__proto__.polluted=1", connection, connectionFields],
    ["claim_mapping.__proto__=x", connection, connectionFields],
    ['attributes.__proto__:={"polluted":true}', user, userFields],
  ])(
    "refuses %s, which the schema check would drop, and touches no prototype",
    (raw, schema, fields) => {
      expect(() => readAssignment(raw, schema, fields)).toThrowError(
        expect.objectContaining({
          code: "E_VALIDATION",
          message: expect.stringContaining("names __proto__, which no body can carry"),
        }),
      );
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    },
  );

  it("takes `constructor` as a key only where any key is legal, and then as data", () => {
    expect(() => set("constructor=x")).toThrowError(
      expect.objectContaining({ message: "--set constructor names no field of this body" }),
    );
    const assignment = readAssignment("attributes.constructor.prototype.x=1", user, userFields);
    expect(JSON.stringify(fragmentOf(assignment))).toBe(
      '{"attributes":{"constructor":{"prototype":{"x":"1"}}}}',
    );
    expect({}.constructor).toBe(Object);
    expect((Object.prototype as Record<string, unknown>).x).toBeUndefined();
  });

  it("cannot name a key that contains a dot, which is set through its parent", () => {
    expect(() => set("claim_mapping.given.name=given_name")).toThrowError(
      expect.objectContaining({
        message: "--set claim_mapping.given.name names no field of this body",
        hint: "Fields: claim_mapping.<key>.",
      }),
    );
    // Objects merge key by key, so the parent's JSON adds the key and keeps the rest.
    const parent = set('claim_mapping:={"given.name":"given_name"}');
    expect(mergeDocuments({ claim_mapping: { email: "email" } }, fragmentOf(parent))).toEqual({
      claim_mapping: { email: "email", "given.name": "given_name" },
    });
    // Below a record whose values are untyped, the dot nests instead.
    expect(fragmentOf(readAssignment("attributes.given.name=Ada", user, userFields))).toEqual({
      attributes: { given: { name: "Ada" } },
    });
  });

  it("sends `null` only from `:=` on a field that takes a string or null", () => {
    const nullable = z.object({ nickname: z.string().nullable() }) as unknown as ZodLike;
    expect(readAssignment("nickname=null", nullable, []).value).toBe("null");
    expect(readAssignment("nickname:=null", nullable, []).value).toBeNull();
  });

  it("takes any path, as text, when there is no schema to check against", () => {
    expect(readAssignment("a.b=1", undefined, [])).toMatchObject({ path: ["a", "b"], value: "1" });
  });
});

describe("readAssignments", () => {
  it("reads every entry in the order given, and none when there are none", () => {
    expect(
      readAssignments(["slug=a", "slug=b"], connection, connectionFields).map(
        (entry) => entry.value,
      ),
    ).toEqual(["a", "b"]);
    expect(readAssignments(undefined, connection, connectionFields)).toEqual([]);
  });
});
