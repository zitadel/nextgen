import assert from "node:assert/strict";
import { glob, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { lint, loadConfig } from "@redocly/openapi-core";
import { test } from "vitest";
import { parse } from "yaml";

// The wire-casing and naming rules are configuration, not code. Nothing else
// in the repo fails when a subject type or regex is wrong: the spec just stops
// being checked, silently, which is the failure these tests exist to catch.

const repoFile = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));

const fixture = (name) =>
  fileURLToPath(new URL(`./testdata/openapi-casing/${name}`, import.meta.url));

// The repo's redocly.yaml, linted with the same pinned Redocly that
// @zitadel/server#openapi runs (both come from the pnpm-workspace.yaml catalog).
const config = await loadConfig({
  configPath: fileURLToPath(new URL("../redocly.yaml", import.meta.url)),
});

/** Lints a fixture with the repo's redocly.yaml and returns only our rules' problems. */
async function wireProblems(name) {
  const problems = await lint({ ref: fixture(name), config });
  // The `rule/wire-` prefix scopes this to our rules, so the `recommended`
  // ruleset the fixtures also trip stays out of the assertions.
  return problems.filter((p) => p.ruleId.startsWith("rule/wire-"));
}

/** Lints a fixture and returns only the operationId and path parameter naming problems. */
async function namingProblems(name) {
  const problems = await lint({ ref: fixture(name), config });
  return problems.filter((p) => NAMING_RULES.includes(p.ruleId));
}

const NAMING_RULES = ["rule/operation-id-verb-camel-case", "rule/path-parameter-not-id"];

/** Lints a fixture and returns only the ID path parameter pattern problems. */
async function pathIdProblems(name) {
  const problems = await lint({ ref: fixture(name), config });
  return problems.filter((p) => p.ruleId === "rule/path-id-parameter-pattern");
}

function flagged(problems, ruleId, value) {
  return problems.some((p) => p.ruleId === ruleId && p.message.includes(`"${value}"`));
}

test("every casing violation in the fixture is reported", async () => {
  const problems = await wireProblems("violations.yaml");
  const expected = [
    ["rule/wire-parameter-no-camel-case", "objectType"],
    ["rule/wire-enum-no-camel-case", "createdAt"],
    ["rule/wire-field-snake-case", "createdAt"],
    ["rule/wire-field-snake-case", "PascalCase"],
  ];
  for (const [ruleId, value] of expected) {
    assert.ok(flagged(problems, ruleId, value), `${ruleId} did not flag ${value}`);
  }
});

test("camelCase past the first word is reported", async () => {
  // Regression guard for the anchored /^[a-z][a-z0-9]*[A-Z]/ these rules
  // shipped with: it cannot cross an underscore, so both values below passed.
  const problems = await wireProblems("violations.yaml");
  assert.ok(flagged(problems, "rule/wire-enum-no-camel-case", "created_atUTC"));
  assert.ok(flagged(problems, "rule/wire-enum-no-camel-case", "some_valueCamel"));
});

test("legitimate header, cookie, and RFC names are left alone", async () => {
  // Idempotency-Key, Origin, _zflow, S256, Bearer, RSA-OAEP-256 and the
  // device_code URN are fixed by HTTP and RFC vocabularies. Requiring
  // snake_case rather than rejecting camelCase would fail all of them.
  assert.deepEqual(await wireProblems("clean.yaml"), []);
});

test("every naming violation in the fixture is reported, each in its own place", async () => {
  const problems = await namingProblems("naming-violations.yaml");
  const expected = [
    ["rule/operation-id-verb-camel-case", "#/paths/~1things/get/operationId"],
    ["rule/operation-id-verb-camel-case", "#/paths/~1things/post/operationId"],
    ["rule/operation-id-verb-camel-case", "#/paths/~1things~1{id}/get/operationId"],
    ["rule/operation-id-verb-camel-case", "#/paths/~1things~1{id}/delete/operationId"],
    ["rule/path-parameter-not-id", "#/paths/~1things~1{id}/parameters/0/name"],
    [
      "rule/path-parameter-not-id",
      "#/paths/~1things~1{thing_id}~1parts~1{id}/get/parameters/1/name",
    ],
  ];
  const found = problems.map((p) => [p.ruleId, p.location[0].pointer]);
  assert.deepEqual(
    found.sort(),
    expected.sort(),
    "each bad operationId and `id` path parameter is reported once, and nothing else",
  );
});

test("allowed verbs, acronyms, webhooks and non-path `id` parameters are left alone", async () => {
  // The webhook's `thingCreated` opens with no allowed verb: it passes only
  // because the rule is scoped to operations under `paths`.
  assert.deepEqual(await namingProblems("naming-clean.yaml"), []);
});

test("every ID path parameter without a pattern is reported, each in its own place", async () => {
  // The shared schema is reported where it is defined: the walk meets it under
  // the query parameter first, which the rule skips, and must still check it
  // under the path parameter.
  const found = (await pathIdProblems("path-id-violations.yaml")).map((p) => p.location[0].pointer);
  assert.deepEqual(
    found.sort(),
    [
      "#/components/parameters/thing-id/schema/pattern",
      "#/components/schemas/plain-string/pattern",
      "#/paths/~1things~1{thing_id}/parameters/0/schema/pattern",
    ].sort(),
  );
});

test("patterned ID path parameters and non-ID or non-path parameters are left alone", async () => {
  assert.deepEqual(await pathIdProblems("path-id-clean.yaml"), []);
});

test("every verb the operationId rule allows is one the spec uses", async () => {
  // The allow-list is the spec's own verbs; one no operation uses any more
  // would let a new operation pick it without review. Every operation under
  // `paths` lives in an endpoints/**/methods.yaml; webhooks live elsewhere.
  const rules = parse(await readFile(repoFile("redocly.yaml"), "utf8")).rules;
  const pattern = rules["rule/operation-id-verb-camel-case"].assertions.pattern;
  const verbs = pattern.match(/^\/\^\(([^)]*)\)/)[1].split("|");
  const used = new Set();
  for await (const file of glob("apps/api/api/openapi/endpoints/**/methods.yaml", {
    cwd: repoFile(""),
  })) {
    for (const op of Object.values(parse(await readFile(repoFile(file), "utf8")))) {
      const verb = op?.operationId?.match(/^[a-z]+/)?.[0];
      if (verb) used.add(verb);
    }
  }
  assert.ok(used.size > 0, "found no operationIds: the methods.yaml glob is stale");
  assert.deepEqual(
    verbs.filter((v) => !used.has(v)),
    [],
    "allowed verbs no operation uses",
  );
});
