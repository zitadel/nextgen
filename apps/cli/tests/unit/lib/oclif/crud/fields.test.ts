import {
  CreateGrantBody,
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
  needsRawBody,
} from "../../../../../src/lib/oclif/crud";

const byName = (schema: Parameters<typeof describeBody>[0]) =>
  Object.fromEntries(describeBody(schema).map((field) => [field.name, field]));

describe("describeBody", () => {
  it("marks required and optional fields from the schema", () => {
    const fields = byName(CreateGrantBody);
    expect(fields.relation?.required).toBe(true);
    expect(fields.expires_at?.required).toBe(false);
    // `user` and `team` are nested objects: no flag, reached through --data.
    expect(fields.user).toBeUndefined();
    expect(fields.team).toBeUndefined();
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

  it("skips fields that would collide with an existing flag", () => {
    const schema = z.object({ data: z.string(), name: z.string() });
    expect(describeBody(schema).map((field) => field.name)).toEqual(["name"]);
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
    expect(describeBody({ safeParse: () => ({ success: true }) })).toEqual([]);
  });
});

describe("bodyFieldFlags", () => {
  it("groups required and optional fields and keeps enum options", () => {
    const flags = bodyFieldFlags(describeBody(CreateGrantBody)) as Record<
      string,
      { helpGroup?: string; description?: string; options?: string[]; multiple?: boolean }
    >;
    expect(flags["relation"]?.helpGroup).toBe("REQUIRED FIELD");
    expect(flags["relation"]?.options).toEqual(["viewer", "editor", "admin"]);
    expect(flags["relation"]?.description).toMatch(/^\(required\) /);
    expect(flags["expires-at"]?.helpGroup).toBe("OPTIONAL FIELD");
    expect(flags["expires-at"]?.description).not.toMatch(/^\(required\)/);
  });

  it("makes a record field repeatable", () => {
    const flags = bodyFieldFlags(describeBody(CreateUserBody)) as Record<
      string,
      { multiple?: boolean; description?: string }
    >;
    expect(flags.attributes?.multiple).toBe(true);
    expect(flags.attributes?.description).toContain("key=value");
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

  it("keeps a numeric-looking string a string with `=`", () => {
    expect(bodyFromFlags(userFields, { attributes: ["postcode=02139", "phone=+1555"] })).toEqual({
      attributes: { postcode: "02139", phone: "+1555" },
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

  it.each(["password", "api_key", "userToken", "client_secret", "PRIVATE_KEY"])(
    "refuses %s as a flag value, since flags are visible to other processes",
    (key) => {
      expect(() => bodyFromFlags(userFields, { attributes: [`${key}=hunter2`] })).toThrowError(
        expect.objectContaining({
          code: "E_VALIDATION",
          hint: expect.stringContaining("--file -"),
        }),
      );
    },
  );

  it("refuses a secret in the JSON form too", () => {
    expect(() => bodyFromFlags(userFields, { attributes: ['token:="abc"'] })).toThrowError(
      expect.objectContaining({ code: "E_VALIDATION" }),
    );
  });

  it("allows keys that merely mention a safe word", () => {
    expect(bodyFromFlags(userFields, { attributes: ["passwordless=true", "tokenizer=v2"] })).toEqual({
      attributes: { passwordless: "true", tokenizer: "v2" },
    });
  });

  it("returns undefined when no field flag was given", () => {
    expect(bodyFromFlags(grantFields, { json: true })).toBeUndefined();
  });
});

describe("needsRawBody", () => {
  it("reports a body whose principal is a nested object", () => {
    // `user` and `team` carry the grant's principal and neither becomes a flag,
    // so no run made of flags alone is a complete grant.
    expect(needsRawBody(CreateGrantBody)).toBe(true);
  });

  it("reports nothing for a body every field of which is a flag", () => {
    expect(needsRawBody(CreateTeamBody)).toBe(false);
    expect(needsRawBody(CreateUserBody)).toBe(false);
    expect(needsRawBody(PatchProjectBody)).toBe(false);
  });

  it("reports nothing for a schema it cannot introspect", () => {
    expect(needsRawBody(z.string())).toBe(false);
  });
});

describe("fieldExample", () => {
  it("uses the required fields and their first allowed value", () => {
    expect(fieldExample(describeBody(CreateGrantBody))).toBe("--relation viewer");
  });

  it("is absent when nothing is required", () => {
    expect(fieldExample(describeBody(PatchProjectBody))).toBeUndefined();
  });
});
