import assert from "node:assert/strict";
import { test } from "node:test";

import {
  computeMode,
  forceFullReason,
  queryAffectedTargets,
  resolveGates,
} from "./ci-mode.mjs";

// Affected sets below are real `moon query tasks --affected --downstream deep`
// results captured on main (2026-08-03/04) for one representative touched
// file per change class. Constants named *_SLICE are hand-trimmed subsets
// exercising one trigger path rather than full captures.

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
const SDK_VUE_CLASS = [
  "release:build-public-packages", "release:pack", "release:publish", "release:snapshot",
  "sdk-vue:build", "sdk-vue:build-release", "sdk-vue:lint", "sdk-vue:test",
  "sdk-vue:typecheck",
];
const LOGIN_UI_CLASS = [
  "console-e2e:e2e-real", "demo-next-e2e:e2e-real", "login-ui:build",
  "login-ui:build-release", "login-ui:dev", "login-ui:lint", "login-ui:preview",
  "login-ui:typecheck", "release:pack", "release:publish", "release:snapshot",
  "server:build", "testing:test-integration",
];
const TESTING_KIT_CLASS = [
  "cli-journey-e2e:e2e", "cli-journey-e2e:e2e-local", "cli-journey-e2e:e2e-testkit",
  "console-e2e:e2e-real", "demo-next-e2e:e2e-real", "release:build-public-packages",
  "release:pack", "release:publish", "release:snapshot", "testing:build",
  "testing:build-release", "testing:lint", "testing:test", "testing:test-integration",
  "testing:typecheck",
];
// Full capture, 2026-08-04: components feeds every SDK, both UIs, the CLI,
// and the journey project — 91 tasks, correctly close to "everything".
const COMPONENTS_CLASS = [
  "cli-journey-e2e:e2e", "cli-journey-e2e:e2e-local", "cli-journey-e2e:e2e-testkit",
  "cli:build", "cli:build-release", "cli:lint", "cli:readme", "cli:test", "cli:typecheck",
  "components:build", "components:build-release", "components:lint", "components:test",
  "components:test-browser", "components:typecheck",
  "console-e2e:e2e", "console-e2e:e2e-real",
  "console:build", "console:build-release", "console:lint", "console:preview",
  "console:test", "console:typecheck",
  "demo-next-e2e:e2e", "demo-next-e2e:e2e-real",
  "demo-next:build", "demo-next:dev", "demo-next:lint", "demo-next:start", "demo-next:typecheck",
  "demo-nuxt-e2e:e2e",
  "demo-nuxt:build", "demo-nuxt:dev", "demo-nuxt:lint", "demo-nuxt:start", "demo-nuxt:typecheck",
  "login-ui:build", "login-ui:build-release", "login-ui:lint", "login-ui:preview",
  "login-ui:typecheck",
  "release:build-public-packages", "release:pack", "release:publish", "release:snapshot",
  "sdk-angular:build", "sdk-angular:build-release", "sdk-angular:lint", "sdk-angular:test",
  "sdk-angular:typecheck",
  "sdk-next:build", "sdk-next:build-release", "sdk-next:lint", "sdk-next:test",
  "sdk-next:typecheck",
  "sdk-nuxt:build", "sdk-nuxt:build-release", "sdk-nuxt:lint", "sdk-nuxt:test",
  "sdk-nuxt:typecheck",
  "sdk-qwik:build", "sdk-qwik:build-release", "sdk-qwik:lint", "sdk-qwik:test",
  "sdk-qwik:typecheck",
  "sdk-react:build", "sdk-react:build-release", "sdk-react:lint", "sdk-react:test",
  "sdk-react:typecheck",
  "sdk-solid:build", "sdk-solid:build-release", "sdk-solid:lint", "sdk-solid:test",
  "sdk-solid:typecheck",
  "sdk-svelte:build", "sdk-svelte:build-release", "sdk-svelte:lint", "sdk-svelte:test",
  "sdk-svelte:typecheck",
  "sdk-vue:build", "sdk-vue:build-release", "sdk-vue:lint", "sdk-vue:test",
  "sdk-vue:typecheck",
  "server:build",
  "storybook:build", "storybook:lint", "storybook:test", "storybook:typecheck",
  "testing:test-integration",
];
// Synthetic slice, NOT a class capture: isolates the `:test-browser`-alone
// trigger for the browsers gate, which no real class produces in isolation.
const TEST_BROWSER_SLICE = ["components:test-browser", "components:lint"];

function allTrue(gates) {
  return Object.values(gates).every(Boolean);
}
function allFalse(gates) {
  return Object.values(gates).every((v) => v === false);
}
function journeys(gates) {
  return [gates.journey_fresh_app, gates.journey_passkey, gates.journey_testkit];
}

test("mode: changeset/version files only is version-only", () => {
  assert.equal(computeMode([".changeset/x.md", "apps/server/package.json"]), "version-only");
  assert.equal(computeMode([".changeset/x.md", "internal/a.go"]), "full");
  assert.equal(computeMode([]), "full");
});

test("version-only mode turns every gate off", () => {
  const { gates, matrix } = resolveGates({
    mode: "version-only",
    files: [".changeset/x.md"],
    targets: [],
  });
  assert.ok(allFalse(gates));
  assert.equal(matrix, "full");
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

test("go change runs everything, but the journey matrix collapses to one framework", () => {
  const { gates, matrix } = resolveGates({ mode: "full", files: ["internal/a.go"], targets: GO_CLASS });
  assert.ok(allTrue(gates));
  assert.equal(matrix, "single");
});

test("console change runs the suites but no journeys and no snapshot", () => {
  const { gates } = resolveGates({
    mode: "full",
    files: ["apps/console/src/api/zitadel.ts"],
    targets: CONSOLE_CLASS,
  });
  assert.deepEqual(journeys(gates), [false, false, false]);
  assert.equal(gates.snapshot, false);
  assert.equal(gates.go_tests, false);
  assert.equal(gates.suites_console, true);
  assert.equal(gates.suites_testing_demo, true);
  assert.equal(gates.browsers, true);
});

test("single-SDK change runs the fresh-app matrix but not the next-scaffold journeys", () => {
  const { gates, matrix } = resolveGates({
    mode: "full",
    files: ["packages/sdk-vue/src/index.ts"],
    targets: SDK_VUE_CLASS,
  });
  assert.deepEqual(journeys(gates), [true, false, false]);
  assert.equal(gates.snapshot, true);
  assert.equal(matrix, "full");
  assert.equal(gates.suites_testing_demo, false);
  assert.equal(gates.go_tests, false);
});

test("login-ui change runs all journeys on a single framework", () => {
  const { gates, matrix } = resolveGates({
    mode: "full",
    files: ["apps/login-ui/src/main.ts"],
    targets: LOGIN_UI_CLASS,
  });
  assert.deepEqual(journeys(gates), [true, true, true]);
  assert.equal(matrix, "single");
  assert.equal(gates.go_tests, false);
  assert.equal(gates.suites_console, true);
});

test("testing-kit change runs all journeys with the full matrix", () => {
  const { gates, matrix } = resolveGates({
    mode: "full",
    files: ["packages/testing/src/index.ts"],
    targets: TESTING_KIT_CLASS,
  });
  assert.deepEqual(journeys(gates), [true, true, true]);
  assert.equal(gates.snapshot, true);
  assert.equal(matrix, "full");
});

test("journey-project change runs all journeys, full matrix, and the snapshot that feeds them", () => {
  const { gates, matrix } = resolveGates({
    mode: "full",
    files: ["apps/cli-journey-e2e/src/user-journey.spec.ts"],
    targets: JOURNEY_CLASS,
  });
  assert.deepEqual(journeys(gates), [true, true, true]);
  assert.equal(gates.snapshot, true);
  assert.equal(matrix, "full");
  assert.equal(gates.go_tests, false);
});

test("components change runs every journey and suite with the full matrix, but no Go suites", () => {
  const { gates, matrix } = resolveGates({
    mode: "full",
    files: ["packages/components/src/atoms/index.ts"],
    targets: COMPONENTS_CLASS,
  });
  assert.deepEqual(journeys(gates), [true, true, true]);
  assert.equal(gates.snapshot, true);
  assert.equal(gates.suites_testing_demo, true);
  assert.equal(gates.suites_console, true);
  assert.equal(gates.browsers, true);
  assert.equal(gates.go_tests, false);
  assert.equal(matrix, "full");
});

test(":test-browser affectedness alone keeps the browser install without journeys", () => {
  const { gates } = resolveGates({
    mode: "full",
    files: ["packages/components/src/atoms/zl-alert.spec.ts"],
    targets: TEST_BROWSER_SLICE,
  });
  assert.equal(gates.browsers, true);
  assert.deepEqual(journeys(gates), [false, false, false]);
});

test("unclaimed files force a full run with the full matrix", () => {
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
    const { gates, matrix } = resolveGates({ mode: "full", files: [file], targets: DOCS_CLASS });
    assert.ok(allTrue(gates), `${file} should gate everything on`);
    assert.equal(matrix, "full");
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
  for (const file of ["tsconfig.base.json", "LICENSE", "README.md", "VISION.md"]) {
    const { gates } = resolveGates({ mode: "full", files: [file], targets: [] });
    assert.ok(allTrue(gates), `${file} must force a full run on an empty set`);
  }
});

test("known repo-wide inputs force full even when the rest of the diff is claimed", () => {
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

