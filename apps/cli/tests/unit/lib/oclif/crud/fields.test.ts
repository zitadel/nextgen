import {
  CreateGrantBody,
  CreateIdpBody,
  CreateTeamBody,
  CreateUserBody,
  PatchProjectBody,
} from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  bodyFieldFlags,
  bodyFromFlags,
  describeBody,
  fieldExample,
  flagsAloneMayBeIncomplete,
} from "../../../../../src/lib/oclif/crud";

type Described = Parameters<typeof describeBody>;

const byName = (...args: Described) =>
  Object.fromEntries(describeBody(...args).map((field) => [field.name, field]));

/** The flags of a body, typed loosely enough to read their options back. */
const flagsOf = (...args: Described) =>
  bodyFieldFlags(describeBody(...args)) as Record<
    string,
    {
      type?: string;
      allowNo?: boolean;
      helpGroup?: string;
      description?: string;
      options?: string[];
      multiple?: boolean;
    }
  >;

describe("describeBody", () => {
  it("marks required and optional fields from the schema", () => {
    const fields = byName(CreateGrantBody);
    expect(fields.relation?.required).toBe(true);
    expect(fields.expires_at?.required).toBe(false);
  });

  it("treats a fully optional body as optional", () => {
    expect(byName(PatchProjectBody).name?.required).toBe(false);
    expect(byName(CreateTeamBody).name?.required).toBe(true);
  });

  it("carries enum options and kebab-cases the flag name", () => {
    const fields = byName(CreateGrantBody);
    expect(fields.relation?.kind).toBe("enum");
    expect(fields.relation?.options).toEqual(["viewer", "editor", "admin"]);
    // A `_` in the wire name becomes a `-` in the flag.
    expect(fields.expires_at?.flag).toBe("expires-at");
  });

  it("summarises a long multi-line description to one sentence", () => {
    const summary = byName(CreateGrantBody).expires_at?.summary ?? "";
    expect(summary).toBe("Optional expiry.");
    expect(summary).not.toContain("\n");
  });

  it("exposes an open record as a repeatable field", () => {
    const fields = byName(CreateUserBody);
    expect(fields.schema?.kind).toBe("string");
    expect(fields.attributes?.kind).toBe("record");
  });

  it("walks into a nested object, naming each leaf by its path", () => {
    const fields = byName(CreateGrantBody);
    expect(fields["user.identifier"]).toMatchObject({
      path: ["user", "identifier"],
      flag: "user-identifier",
      kind: "string",
      required: false,
    });
    expect(fields["team.name"]?.flag).toBe("team-name");
    // The object itself is no field: its leaves are.
    expect(fields.user).toBeUndefined();
  });

  it("addresses the document under a root rather than the request around it", () => {
    const fields = byName(CreateIdpBody, { root: "idp" });
    expect(fields.slug?.flag).toBe("slug");
    expect(fields["oidc.client_id"]?.flag).toBe("oidc-client-id");
    expect(fields["idp.slug"]).toBeUndefined();
  });

  it("gives every leaf of a connection a flag of its own", () => {
    const fields = describeBody(CreateIdpBody, { root: "idp" });
    expect(fields.length).toBe(20);
    expect(fields.every((field) => field.flag !== undefined)).toBe(true);
  });

  it("makes a field required with its optional object, not with every body", () => {
    const fields = byName(CreateIdpBody, { root: "idp" });
    expect(fields["oidc.issuer"]).toMatchObject({ required: false, requiredWith: ["oidc"] });
    // Optional within the block too, so nothing makes it required.
    expect(fields["oidc.jwks_uri"]?.requiredWith).toBeUndefined();
    expect(fields.slug?.requiredWith).toBeUndefined();
  });

  it("ties a field to the innermost optional object around it", () => {
    // `a.b.c` only has to be there once `b` is; giving `a` alone asks for `a.d`.
    const schema = z.object({
      a: z.object({ b: z.object({ c: z.string() }).optional(), d: z.string() }).optional(),
    });
    const fields = byName(schema);
    expect(fields["a.b.c"]?.requiredWith).toEqual(["a", "b"]);
    expect(fields["a.d"]?.requiredWith).toEqual(["a"]);
  });

  it("reads lists, booleans, integers and defaults from the schema", () => {
    const connection = byName(CreateIdpBody, { root: "idp" });
    expect(connection["oidc.scopes"]).toMatchObject({ kind: "list", item: "string" });
    expect(connection["oidc.pkce_enabled"]).toMatchObject({
      kind: "boolean",
      default: { value: true },
    });
    expect(byName(PatchProjectBody)["password_hash.params.cost"]?.kind).toBe("integer");
  });

  it("walks into an object that may also be null", () => {
    // A project's hashing method is an object or `null`, so it has leaves; the
    // string flag the walk used to give it could never make a valid body.
    const fields = byName(PatchProjectBody);
    expect(fields.password_hash).toBeUndefined();
    expect(fields["password_hash.algorithm"]).toMatchObject({
      flag: "password-hash-algorithm",
      kind: "enum",
    });
  });

  it("leaves a field no single flag can hold to --set", () => {
    const schema = z.object({ items: z.array(z.object({ id: z.string() })) });
    expect(byName(schema).items).toMatchObject({ kind: "json", required: true });
    expect(byName(schema).items?.flag).toBeUndefined();
  });

  it("gives no flag to a field that would collide with one the command owns", () => {
    const fields = byName(z.object({ data: z.string(), name: z.string() }));
    expect(fields.data?.flag).toBeUndefined();
    expect(fields.name?.flag).toBe("name");
  });

  it("gives no flag to either of two fields that would share one", () => {
    const fields = byName(z.object({ a_b: z.string(), a: z.object({ b: z.string() }) }));
    expect(fields.a_b?.flag).toBeUndefined();
    expect(fields["a.b"]?.flag).toBeUndefined();
  });

  it("counts the --no- form of a boolean as taken", () => {
    const fields = byName(z.object({ cache: z.boolean(), no_cache: z.string() }));
    expect(fields.cache?.flag).toBeUndefined();
    expect(fields.no_cache?.flag).toBeUndefined();
  });

  it("keeps out of the flags the caller reserves", () => {
    expect(byName(z.object({ extra: z.string() }), { reserved: ["extra"] }).extra?.flag).toBe(
      undefined,
    );
  });

  it("no longer reserves `environment`, which no generated command owns", () => {
    // The reserved set exists to keep a body field from shadowing a flag the
    // command itself declares. No resource command declares `--environment`
    // any more, so a resource whose body carries that field gets its flag.
    const schema = z.object({ environment: z.string() });
    expect(byName(schema).environment?.flag).toBe("environment");
    expect(Object.keys(bodyFieldFlags(describeBody(schema)))).toContain("environment");
  });

  it("returns nothing for a schema it cannot introspect", () => {
    expect(describeBody(z.string())).toEqual([]);
    expect(describeBody({ safeParse: () => ({ success: true, data: {} }) })).toEqual([]);
  });
});

describe("bodyFieldFlags", () => {
  it("groups required and optional fields and keeps enum options", () => {
    const flags = flagsOf(CreateGrantBody);
    expect(flags.relation?.helpGroup).toBe("REQUIRED FIELD");
    expect(flags.relation?.options).toEqual(["viewer", "editor", "admin"]);
    expect(flags.relation?.description).toMatch(/^\(required\) /);
    expect(flags["expires-at"]?.helpGroup).toBe("OPTIONAL FIELD");
    expect(flags["expires-at"]?.description).not.toMatch(/^\(required\)/);
  });

  it("makes a record field repeatable", () => {
    const flags = flagsOf(CreateUserBody);
    expect(flags.attributes?.multiple).toBe(true);
    expect(flags.attributes?.description).toContain("key=value");
  });

  it("groups nested flags by their object and says what makes them required", () => {
    const flags = flagsOf(CreateIdpBody, { root: "idp" });
    expect(flags["oidc-issuer"]?.helpGroup).toBe("OIDC FIELD");
    expect(flags["oidc-issuer"]?.description).toMatch(/^\(required with oidc\.\*\) /);
    expect(flags["provisioning-creation"]?.helpGroup).toBe("PROVISIONING FIELD");
  });

  it("lets a boolean be turned off, and a list take one value per use", () => {
    const flags = flagsOf(CreateIdpBody, { root: "idp" });
    expect(flags["oidc-pkce-enabled"]).toMatchObject({ type: "boolean", allowNo: true });
    expect(flags["oidc-scopes"]).toMatchObject({ multiple: true });
  });

  it("leaves a field without a flag out", () => {
    const flags = flagsOf(z.object({ data: z.string(), name: z.string() }));
    expect(Object.keys(flags)).toEqual(["name"]);
  });
});

describe("bodyFromFlags", () => {
  const grantFields = describeBody(CreateGrantBody);
  const userFields = describeBody(CreateUserBody);

  it("collects scalar and enum flags under their wire names", () => {
    expect(
      bodyFromFlags(grantFields, {
        relation: "viewer",
        "expires-at": "2030-01-01T00:00:00Z",
      }),
    ).toEqual({ relation: "viewer", expires_at: "2030-01-01T00:00:00Z" });
  });

  it("nests a nested field's value at its path", () => {
    expect(
      bodyFromFlags(describeBody(CreateIdpBody, { root: "idp" }), {
        slug: "acme",
        "oidc-issuer": "https://sso.acme.example",
        "oidc-scopes": ["openid", "email"],
        "oidc-pkce-enabled": false,
      }),
    ).toEqual({
      slug: "acme",
      oidc: {
        issuer: "https://sso.acme.example",
        scopes: ["openid", "email"],
        pkce_enabled: false,
      },
    });
  });

  it("builds an object from repeated key=value entries", () => {
    expect(
      bodyFromFlags(userFields, {
        schema: "sch_1",
        attributes: ["email=ada@example.com", "givenName=Ada"],
      }),
    ).toEqual({ schema: "sch_1", attributes: { email: "ada@example.com", givenName: "Ada" } });
  });

  it("parses a `key:=value` entry as JSON so numbers and booleans keep their type", () => {
    expect(
      bodyFromFlags(userFields, {
        attributes: [
          "email=ada@example.com",
          "age:=30",
          "optIn:=true",
          "nickname:=null",
          'tags:=["a","b"]',
          'profile:={"tier":2}',
        ],
      }),
    ).toEqual({
      attributes: {
        email: "ada@example.com",
        age: 30,
        optIn: true,
        nickname: null,
        tags: ["a", "b"],
        profile: { tier: 2 },
      },
    });
  });

  it("keeps a numeric-looking string a string with `=` where the values are untyped", () => {
    expect(bodyFromFlags(userFields, { attributes: ["postcode=02139", "phone=+1555"] })).toEqual({
      attributes: { postcode: "02139", phone: "+1555" },
    });
  });

  it("reads `=` as the type a record declares for its values", () => {
    const fields = describeBody(z.object({ limits: z.record(z.string(), z.number()) }));
    expect(bodyFromFlags(fields, { limits: ["requests=10"] })).toEqual({
      limits: { requests: 10 },
    });
    expect(() => bodyFromFlags(fields, { limits: ["requests=ten"] })).toThrowError(
      expect.objectContaining({
        code: "E_VALIDATION",
        message: '--limits requests expects a number, got "ten"',
      }),
    );
  });

  it("keeps a string where a record's values may be a string or something else", () => {
    // `verified_claims` takes a claim name or `true`; `email=true` names a
    // claim called "true", and `email:=true` is the boolean.
    const fields = describeBody(CreateIdpBody, { root: "idp" });
    expect(bodyFromFlags(fields, { "verified-claims": ["email=true", "phone:=true"] })).toEqual({
      verified_claims: { email: "true", phone: true },
    });
  });

  it("explains a malformed JSON value and offers the string form", () => {
    expect(() => bodyFromFlags(userFields, { attributes: ["age:=thirty"] })).toThrowError(
      expect.objectContaining({
        code: "E_VALIDATION",
        message: '--attributes age:= expects JSON, got "thirty"',
        hint: expect.stringContaining("age=thirty"),
      }),
    );
  });

  it("keeps `=` inside a value", () => {
    expect(bodyFromFlags(userFields, { attributes: ["note=a=b"] })).toEqual({
      attributes: { note: "a=b" },
    });
  });

  it("rejects a malformed pair with an actionable error", () => {
    expect(() => bodyFromFlags(userFields, { attributes: ["nonsense"] })).toThrowError(
      expect.objectContaining({
        code: "E_VALIDATION",
        hint: expect.stringContaining("--attributes key=value"),
      }),
    );
  });

  it("returns undefined when no field flag was given", () => {
    expect(bodyFromFlags(grantFields, { json: true })).toBeUndefined();
  });
});

describe("flagsAloneMayBeIncomplete", () => {
  it("reports a body with a nested object, whose rules the required fields cannot carry", () => {
    // A grant names exactly one of `user` and `team`, so `--relation viewer`
    // alone is no complete grant.
    expect(flagsAloneMayBeIncomplete(describeBody(CreateGrantBody))).toBe(true);
  });

  it("reports a body with a field no flag can carry", () => {
    const schema = z.object({ items: z.array(z.object({ id: z.string() })) });
    expect(flagsAloneMayBeIncomplete(describeBody(schema))).toBe(true);
  });

  it("reports nothing for a flat body every field of which is a flag", () => {
    expect(flagsAloneMayBeIncomplete(describeBody(CreateTeamBody))).toBe(false);
    expect(flagsAloneMayBeIncomplete(describeBody(CreateUserBody))).toBe(false);
  });
});

describe("fieldExample", () => {
  it("uses the required fields and their first allowed value", () => {
    expect(fieldExample(describeBody(CreateGrantBody))).toBe("--relation viewer");
  });

  it("is absent when nothing is required", () => {
    expect(fieldExample(describeBody(PatchProjectBody))).toBeUndefined();
  });

  it("is absent when a required field has no flag", () => {
    const schema = z.object({ items: z.array(z.object({ id: z.string() })) });
    expect(fieldExample(describeBody(schema))).toBeUndefined();
  });
});
