import assert from "node:assert/strict";
import { test } from "node:test";

import { computeMode, forceFullReason, queryAffectedTargets, resolveGates } from "./ci-mode.mjs";

// Affected sets below are real `moon query tasks --affected --downstream deep`
// results captured on 2026-08-03 (post-#665 main) for one representative
// touched file per change class.

const GO_CLASS = [
  "console-e2e:e2e-real", "demo-next-e2e:e2e-real", "release:snapshot",
  "server:build", "server:check-generate", "server:format", "server:generate",
  "server:openapi", "server:test", "server:test-postgres", "server:test-spanner",
  "server:test-sqlite", "server:vet", "testing:test-integration",
];
const DOCS_CLASS = ["workspace:check-adrs"];
const JOURNEY_CLASS = [
  "cli-journey-e2e:e2e", "cli-journey-e2e:e2e-local", "cli-journey-e2e:e2e-testkit",
  "cli-journey-e2e:lint", "cli-journey-e2e:test",
];
const CONSOLE_CLASS = [
  "console-e2e:e2e", "console-e2e:e2e-real", "console:build", "console:build-release",
  "console:dev", "console:dev-real", "console:lint", "console:preview", "console:test",
  "console:typecheck", "demo-next-e2e:e2e-real", "release:pack", "release:publish",
  "release:snapshot", "server:build", "testing:test-integration",
];
const COMPONENTS_SLICE = ["components:build", "components:test-browser", "components:lint"];

function allTrue(gates) {
  return Object.values(gates).every(Boolean);
}
function allFalse(gates) {
  return Object.values(gates).every((v) => v === false);
}

test("mode: changeset/version files only is version-only", () => {
  assert.equal(computeMode([".changeset/x.md", "apps/server/package.json"]), "version-only");
  assert.equal(computeMode([".changeset/x.md", "internal/a.go"]), "full");
  assert.equal(computeMode([]), "full");
});

test("version-only mode turns every gate off", () => {
  const { gates } = resolveGates({ mode: "version-only", files: [".changeset/x.md"], targets: [] });
  assert.ok(allFalse(gates));
});

test("docs-only change gates everything off", () => {
  const { gates, reason } = resolveGates({
    mode: "full",
    files: ["docs/adrs/001-server-cli-cobra-viper.md"],
    targets: DOCS_CLASS,
  });
  assert.equal(reason, null);
  assert.ok(allFalse(gates));
});

test("go change runs go suites, snapshot, journeys (via snapshot), and both suites", () => {
  const { gates } = resolveGates({ mode: "full", files: ["internal/a.go"], targets: GO_CLASS });
  assert.deepEqual(gates, {
    go_tests: true,
    snapshot: true,
    journeys: true,
    suites_testing_demo: true,
    suites_console: true,
    browsers: true,
  });
});

test("journey-only change runs journeys and the snapshot that feeds them, nothing else", () => {
  const { gates } = resolveGates({
    mode: "full",
    files: ["apps/cli-journey-e2e/src/user-journey.spec.ts"],
    targets: JOURNEY_CLASS,
  });
  assert.deepEqual(gates, {
    go_tests: false,
    snapshot: true,
    journeys: true,
    suites_testing_demo: false,
    suites_console: false,
    browsers: true,
  });
});

test("console change runs suites and snapshot-coupled journeys but no go suites", () => {
  const { gates } = resolveGates({
    mode: "full",
    files: ["apps/console/src/api/zitadel.ts"],
    targets: CONSOLE_CLASS,
  });
  assert.equal(gates.go_tests, false);
  assert.equal(gates.suites_console, true);
  assert.equal(gates.suites_testing_demo, true);
  assert.equal(gates.journeys, true);
  assert.equal(gates.snapshot, true);
});

test(":test-browser affectedness alone keeps the browser install", () => {
  const { gates } = resolveGates({
    mode: "full",
    files: ["packages/components/src/atoms/index.ts"],
    targets: COMPONENTS_SLICE,
  });
  assert.equal(gates.browsers, true);
  assert.equal(gates.journeys, false);
});

test("unclaimed files force a full run", () => {
  for (const file of [
    ".github/workflows/ci.yml",
    "scripts/ci-mode.mjs",
    ".moon/workspace.yml",
    "moon.yml",
    "apps/server/moon.yml",
    "pnpm-workspace.yaml",
    ".nvmrc",
  ]) {
    assert.ok(forceFullReason([file]), `${file} should force full`);
    const { gates } = resolveGates({ mode: "full", files: [file], targets: DOCS_CLASS });
    assert.ok(allTrue(gates), `${file} should gate everything on`);
  }
});

test("an empty diff forces a full run", () => {
  const { gates, reason } = resolveGates({ mode: "full", files: [], targets: [] });
  assert.ok(allTrue(gates));
  assert.equal(reason, "empty diff");
});

test("a failed affected query fails open", () => {
  const { gates, reason } = resolveGates({
    mode: "full",
    files: ["internal/a.go"],
    targets: null,
  });
  assert.ok(allTrue(gates));
  assert.equal(reason, "affected query failed");
});

test("an empty affected set skips only for allowlisted-inert files", () => {
  for (const file of ["docs/runbooks/manual-release.md", "docs/design/notes.md", "AGENTS.md"]) {
    const { gates, reason } = resolveGates({ mode: "full", files: [file], targets: [] });
    assert.equal(reason, null, file);
    assert.ok(allFalse(gates), file);
  }
});

test("an empty affected set for unallowlisted files fails open (tsconfig.base.json repro)", () => {
  // moon's input graph does not claim these, yet they reach typechecks and
  // release archives — unclaimed is not inert.
  for (const file of ["tsconfig.base.json", "LICENSE", "README.md", "VISION.md"]) {
    const { gates } = resolveGates({ mode: "full", files: [file], targets: [] });
    assert.ok(allTrue(gates), `${file} must force a full run on an empty set`);
  }
});

test("known repo-wide inputs force full even when the rest of the diff is claimed", () => {
  // Mixed diff: an ADR (claimed, selects check-adrs) plus tsconfig.base.json.
  // The non-empty set must not mask the unclaimed dangerous file.
  const { gates, reason } = resolveGates({
    mode: "full",
    files: ["docs/adrs/001-server-cli-cobra-viper.md", "tsconfig.base.json"],
    targets: DOCS_CLASS,
  });
  assert.ok(allTrue(gates));
  assert.match(reason, /tsconfig\.base\.json/);
});

function fakeSpawn(result) {
  return () => ({ status: 0, stdout: "", stderr: "", ...result });
}

test("queryAffectedTargets parses the grouped task map", () => {
  const targets = queryAffectedTargets(
    "HEAD",
    fakeSpawn({ stdout: '{"tasks":{"server":{"test":{},"build":{}},"release":{"snapshot":{}}}}' }),
  );
  assert.deepEqual(targets?.sort(), ["release:snapshot", "server:build", "server:test"]);
});

test("queryAffectedTargets returns an empty set for an empty tasks map", () => {
  assert.deepEqual(queryAffectedTargets("HEAD", fakeSpawn({ stdout: '{"tasks":{}}' })), []);
});

test("queryAffectedTargets fails open on schema drift, garbage output, and nonzero exits", () => {
  assert.equal(queryAffectedTargets("HEAD", fakeSpawn({ stdout: '{"unexpected":true}' })), null);
  assert.equal(queryAffectedTargets("HEAD", fakeSpawn({ stdout: '{"tasks":[1,2]}' })), null);
  assert.equal(queryAffectedTargets("HEAD", fakeSpawn({ stdout: "not json" })), null);
  assert.equal(queryAffectedTargets("HEAD", fakeSpawn({ status: 1, stderr: "boom" })), null);
});
