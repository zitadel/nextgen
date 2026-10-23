/**
 * Tests for the renderer of the hosted built-in schemas, run by the root
 * `test` task. They pin the two rules it shares with the server's
 * domain.WriteBuiltinJSONSchema (`$id` is the document's URL, a relative
 * `$ref` resolves against it) and what the hosted cloud relies on: every
 * built-in rendered, and no `$ref` into the namespace that would answer 404.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import {
  documentRefs,
  HOSTED_BASE,
  normalizeBase,
  renderBuiltinSchema,
  renderBuiltinSchemas,
  SOURCE_DIR,
  writeBuiltinSchemas,
} from "./render-builtin-schemas.mjs";
import { DEFAULT_BUILTIN_SCHEMA_BASE } from "../packages/config/src/defaults.ts";

const BASE = "https://schemas.example.test/v1";

/** A source directory holding `files` (name to document). */
function sourceDir(files) {
  const dir = mkdtempSync(join(tmpdir(), "builtin-schemas-"));
  for (const [name, document] of Object.entries(files)) {
    writeFileSync(join(dir, name), JSON.stringify(document));
  }
  return dir;
}

test("a document's $id is its URL, after $schema and ahead of the rest", () => {
  const rendered = renderBuiltinSchema(
    { type: "object", $schema: "https://json-schema.org/draft/2020-12/schema", $id: "stale" },
    `${BASE}/a.json`,
  );
  assert.deepEqual(Object.keys(rendered), ["$schema", "$id", "type"]);
  assert.equal(rendered.$id, `${BASE}/a.json`);
});

test("a relative $ref resolves against the document's URL; nothing else changes", () => {
  const source = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    description: "see b.json",
    properties: {
      sibling: { $ref: "b.json" },
      pointer: { $ref: "b.json#/$defs/x" },
      parent: { $ref: "../v0/c.json" },
      local: { $ref: "#/$defs/d" },
      absolute: { $ref: "https://json-schema.org/draft/2020-12/schema" },
      empty: { $ref: "" },
      // A property named "$ref" holds a schema, not a reference.
      $ref: { type: "string", examples: ["b.json"] },
    },
    allOf: [{ $ref: "b.json" }],
  };
  const rendered = renderBuiltinSchema(source, `${BASE}/a.json`);

  assert.deepEqual(rendered.properties, {
    sibling: { $ref: `${BASE}/b.json` },
    pointer: { $ref: `${BASE}/b.json#/$defs/x` },
    parent: { $ref: "https://schemas.example.test/v0/c.json" },
    local: { $ref: "#/$defs/d" },
    absolute: { $ref: "https://json-schema.org/draft/2020-12/schema" },
    empty: { $ref: "" },
    $ref: { type: "string", examples: ["b.json"] },
  });
  assert.deepEqual(rendered.allOf, [{ $ref: `${BASE}/b.json` }]);
  assert.equal(rendered.description, "see b.json");
  assert.equal(rendered.$schema, source.$schema);
  // The source is left as it was.
  assert.equal(source.properties.sibling.$ref, "b.json");
});

test("every built-in is rendered under the hosted base, its $refs all served", () => {
  const sources = readdirSync(SOURCE_DIR).filter((name) => name.endsWith(".json"));
  const documents = renderBuiltinSchemas();

  assert.deepEqual([...documents.keys()], sources.sort());
  for (const [name, document] of documents) {
    assert.equal(document.$id, `${HOSTED_BASE}/${name}`);
    for (const ref of documentRefs(document)) {
      assert.match(ref, /^https:\/\//, `${name} keeps a relative $ref: ${ref}`);
      if (ref.startsWith(`${HOSTED_BASE}/`)) {
        assert.ok(documents.has(ref.slice(HOSTED_BASE.length + 1)), `${name}: ${ref}`);
      }
    }
  }
  // The user schema reaches the auth methods through a relative $ref.
  assert.ok(
    documentRefs(documents.get("user-schema.json")).has(`${HOSTED_BASE}/auth-methods.json`),
  );
});

test("a $ref into the namespace that names no built-in fails the build", () => {
  const dir = sourceDir({
    "a.json": { properties: { b: { $ref: "b.json#/$defs/x" } } },
    "c.json": { type: "string" },
  });
  assert.throws(
    () => renderBuiltinSchemas({ base: BASE, sourceDir: dir }),
    (error) => error.message.includes(`a.json: ${BASE}/b.json`),
  );
});

test("a base is an absolute http(s) URL; a trailing slash is dropped", () => {
  assert.equal(normalizeBase(`${BASE}/`), BASE);
  assert.equal(
    normalizeBase("http://localhost:3000/schemas/v1"),
    "http://localhost:3000/schemas/v1",
  );
  for (const base of ["schemas/v1", "file:///schemas/v1", `${BASE}?v=1`, `${BASE}#x`]) {
    assert.throws(() => normalizeBase(base), undefined, base);
  }
});

test("the files land under the base's path, and stale ones go", () => {
  const out = mkdtempSync(join(tmpdir(), "builtin-schemas-out-"));
  const documents = renderBuiltinSchemas({
    base: BASE,
    sourceDir: sourceDir({ "a.json": { $ref: "b.json" }, "b.json": { type: "string" } }),
  });
  const first = writeBuiltinSchemas(documents, { base: BASE, outDir: out });
  assert.equal(first, join(out, "v1"));
  writeFileSync(join(first, "gone.json"), "{}");
  writeFileSync(join(first, "README"), "kept");

  writeBuiltinSchemas(documents, { base: BASE, outDir: out });
  assert.deepEqual(readdirSync(first).sort(), ["README", "a.json", "b.json"]);
  assert.equal(
    readFileSync(join(first, "a.json"), "utf8"),
    `${JSON.stringify({ $id: `${BASE}/a.json`, $ref: `${BASE}/b.json` }, null, 2)}\n`,
  );
});

test("publishes under the namespace the server mints ids in", () => {
  // The two bases move together: a document whose $id the server does not
  // know as a built-in would be fetched as anyone's schema.
  assert.equal(HOSTED_BASE, DEFAULT_BUILTIN_SCHEMA_BASE);
});
