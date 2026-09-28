import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// The wire-casing rules are configuration, not code. Nothing else in the repo
// fails when a subject type or regex is wrong: the spec just stops being
// checked, silently, which is the failure these tests exist to catch.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const fixture = (name) =>
  fileURLToPath(new URL(`./testdata/openapi-casing/${name}`, import.meta.url));

// Read the pin from the task that actually gates CI, so a bump there cannot
// leave these tests validating a redocly the pipeline no longer runs.
const serverTasks = readFileSync(new URL("../apps/server/moon.yml", import.meta.url), "utf8");
const redoclyPin = serverTasks.match(/@redocly\/cli@([\d.]+)/)?.[1];
assert.ok(redoclyPin, "could not read the @redocly/cli pin from apps/server/moon.yml");

/** Lints a fixture with the repo's redocly.yaml and returns only our rules' problems. */
function wireProblems(name) {
  const args = ["--yes", `@redocly/cli@${redoclyPin}`, "lint", fixture(name), "--format=json"];
  let stdout;
  try {
    stdout = execFileSync("npx", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (err) {
    // Any reported error exits non-zero; the JSON report is still on stdout.
    stdout = err.stdout;
  }
  assert.ok(stdout, `redocly produced no report for ${name}`);
  // The `rule/wire-` prefix scopes this to our rules, so the `recommended`
  // ruleset the fixtures also trip stays out of the assertions.
  return JSON.parse(stdout).problems.filter((p) => p.ruleId.startsWith("rule/wire-"));
}

function flagged(problems, ruleId, value) {
  return problems.some((p) => p.ruleId === ruleId && p.message.includes(`"${value}"`));
}

test("every casing violation in the fixture is reported", () => {
  const problems = wireProblems("violations.yaml");
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

test("camelCase past the first word is reported", () => {
  // Regression guard for the anchored /^[a-z][a-z0-9]*[A-Z]/ these rules
  // shipped with: it cannot cross an underscore, so both values below passed.
  const problems = wireProblems("violations.yaml");
  assert.ok(flagged(problems, "rule/wire-enum-no-camel-case", "created_atUTC"));
  assert.ok(flagged(problems, "rule/wire-enum-no-camel-case", "some_valueCamel"));
});

test("legitimate header, cookie, and RFC names are left alone", () => {
  // Idempotency-Key, Origin, _zflow, S256, Bearer, RSA-OAEP-256 and the
  // device_code URN are fixed by HTTP and RFC vocabularies. Requiring
  // snake_case rather than rejecting camelCase would fail all of them.
  assert.deepEqual(wireProblems("clean.yaml"), []);
});
