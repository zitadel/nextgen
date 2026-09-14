/**
 * Fixture tests for the meta-schema generator, run by the root `test` task.
 *
 * The generated-output check proves the committed JSON matches what the
 * generator produces today; it cannot tell a correct conversion from one that
 * is consistently wrong. These pin each rule on small YAML fixtures, so a
 * change to `$ref`, `x-local`, `example` or `allOf` handling fails here
 * instead of shipping a quietly different contract.
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DRAFT, MARKER, findSources, generateSchema } from "./generate-meta-schemas.ts";

/** Writes `files` into a fresh directory and generates `name` from it. */
function generate(files: Record<string, string>, name: string) {
  const dir = mkdtempSync(join(tmpdir(), "meta-schemas-"));
  for (const [file, body] of Object.entries(files)) {
    writeFileSync(join(dir, file), body);
  }
  const sources = findSources(dir);
  return { sources: sources.map((path) => path.slice(dir.length + 1)), schema: generateSchema(join(dir, name), new Set(sources)) };
}

test("emits only marked files, stamped with the marker, draft and a derived title", () => {
  const { sources, schema } = generate(
    {
      "user-thing.yaml": "x-meta-schema: true\ntype: object\n",
      "component.yaml": "type: string\n",
    },
    "user-thing.yaml",
  );
  assert.deepEqual(sources, ["user-thing.yaml"]);
  assert.equal(schema.$comment, MARKER);
  assert.equal(schema.$schema, DRAFT);
  assert.equal(schema.title, "UserThing");
  assert.equal("x-meta-schema" in schema, false);
});

test("keeps a title the YAML declares", () => {
  const { schema } = generate({ "a.yaml": "x-meta-schema: true\ntitle: Explicit\ntype: object\n" }, "a.yaml");
  assert.equal(schema.title, "Explicit");
});

test("renames OpenAPI example to examples without clobbering an explicit list", () => {
  const { schema } = generate(
    {
      "a.yaml": [
        "x-meta-schema: true",
        "type: object",
        "properties:",
        "  single:",
        "    type: string",
        "    example: one",
        "  listed:",
        "    type: string",
        "    examples: [x, y]",
      ].join("\n"),
    },
    "a.yaml",
  );
  const properties = schema.properties as Record<string, Record<string, unknown>>;
  assert.deepEqual(properties.single, { type: "string", examples: ["one"] });
  assert.deepEqual(properties.listed, { type: "string", examples: ["x", "y"] });
});

test("lets an x-local: file field hold its value or a $file reference, annotations outside", () => {
  const { schema } = generate(
    {
      "a.yaml": [
        "x-meta-schema: true",
        "type: object",
        "properties:",
        "  template:",
        "    type: string",
        "    maxLength: 10",
        "    description: The template.",
        "    example: <p/>",
        "    x-local: file",
      ].join("\n"),
    },
    "a.yaml",
  );
  const properties = schema.properties as Record<string, unknown>;
  assert.deepEqual(properties.template, {
    description: "The template.",
    examples: ["<p/>"],
    "x-local": "file",
    anyOf: [{ type: "string", maxLength: 10 }, { $ref: "#/$defs/LocalFileReference" }],
  });
  const reference = (schema.$defs as Record<string, Record<string, unknown>>).LocalFileReference;
  assert.deepEqual(reference?.required, ["$file"]);
  assert.equal(reference?.additionalProperties, false);
});

test("rejects an x-local kind it does not know", () => {
  assert.throws(
    () => generate({ "a.yaml": "x-meta-schema: true\ntype: string\nx-local: url\n" }, "a.yaml"),
    /unsupported x-local value "url"/,
  );
});

test("keeps a $ref to another emitted file as a sibling .json reference", () => {
  const { schema } = generate(
    {
      "parent.yaml": "x-meta-schema: true\ntype: object\nproperties:\n  child:\n    $ref: child.yaml\n",
      "child.yaml": "x-meta-schema: true\ntype: string\n",
    },
    "parent.yaml",
  );
  assert.deepEqual((schema.properties as Record<string, unknown>).child, { $ref: "child.json" });
  assert.equal("$defs" in schema, false);
});

test("inlines a non-emitted $ref once under $defs and survives self-reference", () => {
  const { schema } = generate(
    {
      "flow.yaml": [
        "x-meta-schema: true",
        "type: object",
        "properties:",
        "  first:",
        "    $ref: step-node.yaml",
        "  second:",
        "    $ref: step-node.yaml",
      ].join("\n"),
      "step-node.yaml": [
        "type: object",
        "additionalProperties: false",
        "properties:",
        "  next:",
        "    $ref: step-node.yaml",
      ].join("\n"),
    },
    "flow.yaml",
  );
  const properties = schema.properties as Record<string, unknown>;
  assert.deepEqual(properties.first, { $ref: "#/$defs/StepNode" });
  assert.deepEqual(properties.second, { $ref: "#/$defs/StepNode" });
  assert.deepEqual(schema.$defs, {
    StepNode: {
      type: "object",
      additionalProperties: false,
      properties: { next: { $ref: "#/$defs/StepNode" } },
    },
  });
});

test("adds the draft allOf only to json-schema meta-schemas", () => {
  const documents = generate({ "doc.yaml": "x-meta-schema: json-schema\ntype: object\n" }, "doc.yaml").schema;
  const plain = generate({ "leaf.yaml": "x-meta-schema: true\ntype: string\n" }, "leaf.yaml").schema;
  assert.deepEqual(documents.allOf, [{ $ref: DRAFT }]);
  assert.equal("allOf" in plain, false);
});
