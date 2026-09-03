import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SCHEMA_DESIGNATION_RULES, validateUserSchemaDesignations } from "./schema-validate.js";
import { schemaConfigSchema } from "./schemas.js";

/** A password-enabled document with the given root-level extras. */
function doc(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    type: "object",
    "x-auth-methods": { password: { enabled: true } },
    ...extra,
  };
}

const emailLeaf = { type: "string", "x-unique": "project" };

describe("validateUserSchemaDesignations", () => {
  // Case-for-case mirror of TestTenantSchemaValidator_UserSchemaDesignations
  // (internal/domain/schema_validator_test.go). `want` is the exact server
  // detail string — client-visible end to end, asserted verbatim.
  const cases: { name: string; schema: Record<string, unknown>; want?: string }[] = [
    {
      name: "identifier on a project-unique leaf",
      schema: doc({ "x-identifier": "email", properties: { email: emailLeaf } }),
    },
    {
      name: "identifier on a nested leaf path",
      schema: doc({
        "x-identifier": "contact.email",
        properties: { contact: { type: "object", properties: { email: emailLeaf } } },
      }),
    },
    {
      name: "password enabled without a designation",
      schema: doc({ properties: { email: emailLeaf } }),
      want: 'schema designation invalid: password authentication is enabled but the schema designates no "x-identifier"',
    },
    {
      name: "passkey-only schema needs no designation",
      schema: {
        type: "object",
        "x-auth-methods": { passkey: { enabled: true } },
        properties: { email: { type: "string" } },
      },
    },
    {
      name: "identifier naming an unknown property",
      schema: doc({ "x-identifier": "username", properties: { email: emailLeaf } }),
      want: 'schema designation invalid: "x-identifier" names unknown property "username"',
    },
    {
      name: "identifier on a non-unique property",
      schema: doc({ "x-identifier": "email", properties: { email: { type: "string" } } }),
      want: 'schema designation invalid: "x-identifier" property "email" must carry x-unique "project", has ""',
    },
    {
      name: "identifier on a team-unique property",
      schema: doc({
        "x-identifier": "email",
        properties: { email: { type: "string", "x-unique": "team" } },
      }),
      want: 'schema designation invalid: "x-identifier" property "email" must carry x-unique "project", has "team"',
    },
    {
      name: "identifier hiding an object behind a $ref is indeterminate",
      schema: doc({
        "x-identifier": "profile",
        properties: { profile: { $ref: "#/$defs/profile", "x-unique": "project" } },
      }),
      want: 'schema designation invalid: "x-identifier" property "profile" must locally declare exactly one scalar type',
    },
    {
      name: "identifier composed via allOf is indeterminate",
      schema: doc({
        "x-identifier": "handle",
        properties: { handle: { allOf: [{ type: "string" }], "x-unique": "project" } },
      }),
      want: 'schema designation invalid: "x-identifier" property "handle" must locally declare exactly one scalar type',
    },
    {
      name: "identifier on a patternProperties object is not a leaf",
      schema: doc({
        "x-identifier": "tags",
        properties: {
          tags: { patternProperties: { ".*": { type: "string" } }, "x-unique": "project" },
        },
      }),
      want: 'schema designation invalid: "x-identifier" property "tags" must locally declare exactly one scalar type',
    },
    {
      name: "identifier on an untyped property is indeterminate",
      schema: doc({ "x-identifier": "email", properties: { email: { "x-unique": "project" } } }),
      want: 'schema designation invalid: "x-identifier" property "email" must locally declare exactly one scalar type',
    },
    {
      name: "allOf constraining a declared scalar stays a valid designation",
      schema: doc({
        "x-identifier": "email",
        properties: { email: { type: "string", allOf: [{ minLength: 3 }], "x-unique": "project" } },
      }),
    },
    {
      name: "inert object-only keywords on a declared scalar stay valid",
      schema: doc({
        "x-identifier": "email",
        properties: {
          email: { type: "string", additionalProperties: false, "x-unique": "project" },
        },
      }),
    },
    {
      name: "a nullable scalar union is a valid designation target",
      schema: doc({
        "x-identifier": "email",
        properties: { email: { type: ["null", "string"], "x-unique": "project" } },
      }),
    },
    {
      name: "an all-scalar type union is rejected like the flow resolver rejects it",
      schema: doc({
        "x-identifier": "handle",
        properties: { handle: { type: ["string", "integer"], "x-unique": "project" } },
      }),
      want: 'schema designation invalid: "x-identifier" property "handle" must locally declare exactly one scalar type',
    },
    {
      name: "a null-only type cannot identify anyone",
      schema: doc({
        "x-identifier": "ghost",
        properties: { ghost: { type: "null", "x-unique": "project" } },
      }),
      want: 'schema designation invalid: "x-identifier" property "ghost" must locally declare exactly one scalar type',
    },
    {
      name: "a null-only union cannot identify anyone",
      schema: doc({
        "x-identifier": "ghost",
        properties: { ghost: { type: ["null"], "x-unique": "project" } },
      }),
      want: 'schema designation invalid: "x-identifier" property "ghost" must locally declare exactly one scalar type',
    },
    {
      name: "a scalar-typed schema root cannot carry a designation",
      schema: {
        type: "string",
        "x-auth-methods": { password: { enabled: true } },
        "x-identifier": "email",
        properties: { email: emailLeaf },
      },
      want: 'schema designation invalid: "x-identifier" path "email": the schema root is not an object',
    },
    {
      name: "an intermediate segment on a scalar-typed parent is unreachable",
      schema: doc({
        "x-identifier": "contact.email",
        properties: { contact: { type: "string", properties: { email: emailLeaf } } },
      }),
      want: 'schema designation invalid: "x-identifier" path "contact.email": segment "contact" is not an object',
    },
    {
      name: "a nullable-object intermediate segment is reachable",
      schema: doc({
        "x-identifier": "contact.email",
        properties: {
          contact: { type: ["null", "object"], properties: { email: emailLeaf } },
        },
      }),
    },
    {
      name: "identifier on an implicit object (properties without type)",
      schema: doc({
        "x-identifier": "contact",
        properties: {
          contact: { properties: { email: { type: "string" } }, "x-unique": "project" },
        },
      }),
      want: 'schema designation invalid: "x-identifier" property "contact" must locally declare exactly one scalar type',
    },
    {
      name: "identifier on an array is not a leaf",
      schema: doc({
        "x-identifier": "emails",
        properties: { emails: { type: "array", items: { type: "string" }, "x-unique": "project" } },
      }),
      want: 'schema designation invalid: "x-identifier" property "emails" must locally declare exactly one scalar type',
    },
    {
      name: "identifier on a nullable-object type union is not a leaf",
      schema: doc({
        "x-identifier": "profile",
        properties: { profile: { type: ["null", "object"], "x-unique": "project" } },
      }),
      want: 'schema designation invalid: "x-identifier" property "profile" must locally declare exactly one scalar type',
    },
    {
      name: "identifier on an object is not a leaf",
      schema: doc({
        "x-identifier": "profile",
        properties: { profile: { type: "object", "x-unique": "project" } },
      }),
      want: 'schema designation invalid: "x-identifier" property "profile" must locally declare exactly one scalar type',
    },
    {
      name: "display on leaves without uniqueness",
      schema: doc({
        "x-identifier": "email",
        "x-display": ["givenName", "familyName"],
        properties: {
          email: emailLeaf,
          givenName: { type: "string" },
          familyName: { type: "string" },
        },
      }),
    },
    {
      name: "display naming an unknown property",
      schema: doc({
        "x-identifier": "email",
        "x-display": ["nickname"],
        properties: { email: emailLeaf },
      }),
      want: 'schema designation invalid: "x-display" names unknown property "nickname"',
    },
    {
      name: "display entry must be a leaf",
      schema: doc({
        "x-identifier": "email",
        "x-display": ["profile"],
        properties: { email: emailLeaf, profile: { type: "object" } },
      }),
      want: 'schema designation invalid: "x-display" property "profile" must locally declare exactly one scalar type',
    },
  ];

  for (const tt of cases) {
    it(tt.name, () => {
      const issues = validateUserSchemaDesignations(tt.schema);
      if (tt.want === undefined) {
        expect(issues, JSON.stringify(issues)).toEqual([]);
      } else {
        expect(issues.map((i) => i.message)).toContain(tt.want);
      }
    });
  }

  it("collects every issue instead of failing fast (documented Go divergence)", () => {
    const issues = validateUserSchemaDesignations(
      doc({
        // No identifier while password is enabled AND two bad display entries.
        "x-display": ["", "nickname"],
        properties: { email: emailLeaf },
      }),
    );
    expect(issues.map((i) => i.message)).toEqual([
      'schema designation invalid: password authentication is enabled but the schema designates no "x-identifier"',
      'schema designation invalid: "x-display" entries must be non-empty property paths',
      'schema designation invalid: "x-display" names unknown property "nickname"',
    ]);
    expect(issues.map((i) => i.path)).toEqual([
      ["x-auth-methods", "password", "enabled"],
      ["x-display", 0],
      ["x-display", 1],
    ]);
  });

  it("skips a non-array x-display like the Go type assertion", () => {
    expect(
      validateUserSchemaDesignations(
        doc({ "x-identifier": "email", "x-display": "email", properties: { email: emailLeaf } }),
      ),
    ).toEqual([]);
  });
});

describe("schemaConfigSchema designation refine", () => {
  it("rejects a password-enabled user schema without a designation", () => {
    const result = schemaConfigSchema.safeParse({
      kind: "user-schema",
      metaSchema: "https://example.com/user-schema.json",
      $id: "https://example.com/schemas/broken.json",
      type: "object",
      "x-auth-methods": { password: { enabled: true } },
      properties: { email: { type: "string" } },
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain(
      "password authentication is enabled but the schema designates no",
    );
  });

  it("passes a designating user schema", () => {
    const result = schemaConfigSchema.safeParse({
      kind: "user-schema",
      metaSchema: "https://example.com/user-schema.json",
      $id: "https://example.com/schemas/ok.json",
      type: "object",
      "x-identifier": "email",
      "x-auth-methods": { password: { enabled: true } },
      properties: { email: { type: "string", "x-unique": "project" } },
    });
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it("leaves the schema-url union arm untouched", () => {
    const result = schemaConfigSchema.safeParse({
      kind: "schema-url",
      url: "https://example.com/schemas/remote.json",
    });
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });
});

describe("drift audit (Go designation validator)", () => {
  const goSource = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../..",
    "internal/domain/schema_designation.go",
  );

  it.skipIf(!existsSync(goSource))("every goRef function still exists in the Go source", () => {
    const source = readFileSync(goSource, "utf8");
    for (const [rule, { goRef }] of Object.entries(SCHEMA_DESIGNATION_RULES)) {
      expect(source, `rule ${rule} → Go func ${goRef}`).toMatch(new RegExp(`func ${goRef}\\(`));
    }
  });

  it.skipIf(!existsSync(goSource))("the Go validator gained no unported functions", () => {
    const source = readFileSync(goSource, "utf8");
    const goFuncs = [...source.matchAll(/^func (\w+)\(/gm)].map((m) => m[1]).sort();
    const ported = Object.values(SCHEMA_DESIGNATION_RULES)
      .map((rule) => rule.goRef)
      .sort();
    // Readers (DesignatedIdentifier, DesignatedDisplay, ...) resolve values at
    // read time and enforce nothing — plan has no rule to mirror for them.
    // NOT a place to park an unported rule: a new validation function here
    // silently reopens the plan-passes/apply-fails gap this port closes.
    const readers = goFuncs.filter(
      (name) => name !== undefined && (name.startsWith("Designated") || name.startsWith("Resolve")),
    );
    expect(goFuncs).toEqual([...ported, ...readers].sort());
  });

  it.skipIf(!existsSync(goSource))("shared message literals still match the Go source", () => {
    const source = readFileSync(goSource, "utf8");
    for (const fragment of [
      "schema designation invalid",
      "password authentication is enabled but the schema designates no",
      "names unknown property",
      "must carry",
      "is not an object",
      "must locally declare exactly one scalar type",
      "entries must be non-empty property paths",
      "the schema root",
    ]) {
      expect(source).toContain(fragment);
    }
    // The scalar set and the annotation literals the messages embed.
    for (const literal of ['"string", "number", "integer", "boolean"']) {
      expect(source.replace(/\s+/g, " ")).toContain(literal.replace(/\s+/g, " "));
    }
  });

  const annotationsSource = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../..",
    "internal/domain/schema_annotations.go",
  );

  it.skipIf(!existsSync(annotationsSource))("annotation literals still match", () => {
    const source = readFileSync(annotationsSource, "utf8");
    for (const literal of ['"x-identifier"', '"x-display"', '"x-unique"', '"x-auth-methods"', '"project"']) {
      expect(source).toContain(literal);
    }
  });
});
