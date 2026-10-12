import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { lint, loadConfig } from "@redocly/openapi-core";
import { test } from "vitest";

// The wire-casing rules are configuration, not code. Nothing else in the repo
// fails when a subject type or regex is wrong: the spec just stops being
// checked, silently, which is the failure these tests exist to catch.

const fixture = (name) =>
  fileURLToPath(new URL(`./testdata/openapi-casing/${name}`, import.meta.url));

// The repo's redocly.yaml, linted with the same pinned Redocly that
// server:openapi runs (both come from the pnpm-workspace.yaml catalog).
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
