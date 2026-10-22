import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import {
  affectedTurboTargets,
  computeMode,
  forceFullReason,
  queryAffectedTargets,
  ranInGraph,
  readCiReport,
  resolveGates,
} from "./ci-mode.mjs";

// Affected sets below are real `moon query tasks --affected --downstream deep`
// results (moon 2.6.1, 2026-10-14, after the e2e projects merged into `e2e`)
// for one representative touched file per change class. Tests that pass an
// inline list use a hand-made slice exercising one trigger path instead.

const GO_CLASS = [
  "bench:build",
  "bench:summarize",
  "bench:sweep",
  "bench:test",
  "bench:vet",
  "e2e:all",
  "e2e:console-embedded",
  "e2e:console-platform",
  "e2e:console-real",
  "e2e:demo-next-real",
  "release:snapshot",
  "server:build",
  "server:check-generate",
  "server:check-generate-pruned",
  "server:format",
  "server:generate",
  "server:lint",
  "server:openapi",
  "server:test",
  "server:test-postgres",
  "server:test-spanner",
  "server:test-sqlite",
  "server:vet",
  "testing:test-integration",
];
const DOCS_CLASS = ["workspace:check-adrs"];
const JOURNEY_CLASS = [
  "e2e:all",
  "e2e:journey",
  "e2e:journey-local",
  "e2e:lint",
  "e2e:test",
  "e2e:typecheck",
];
const CONSOLE_CLASS = [
  "console:build",
  "console:build-release",
  "console:dev",
  "console:dev-claim",
  "console:dev-real",
  "console:lint",
  "console:preview",
  "console:test",
  "console:typecheck",
  "e2e:all",
  "e2e:console-embedded",
  "e2e:console-platform",
  "e2e:console-real",
  "e2e:console-smoke",
  "e2e:demo-next-real",
  "release:pack",
  "release:publish",
  "release:snapshot",
  "server:build",
  "server:lint",
  "server:test",
  "server:test-postgres",
  "server:test-spanner",
  "server:test-sqlite",
  "server:vet",
  "testing:test-integration",
  "workspace:build-local-image",
  "workspace:smoke-container",
];
const SDK_VUE_CLASS = [
  "e2e:all",
  "e2e:journey-local",
  "release:build-public-packages",
  "release:pack",
  "release:publish",
  "release:snapshot",
  "sdk-vue:build",
  "sdk-vue:build-release",
  "sdk-vue:lint",
  "sdk-vue:test",
  "sdk-vue:typecheck",
];
const LOGIN_UI_CLASS = [
  "e2e:all",
  "e2e:console-embedded",
  "e2e:console-platform",
  "e2e:console-real",
  "e2e:demo-next-real",
  "login-ui:build",
  "login-ui:build-release",
  "login-ui:dev",
  "login-ui:lint",
  "login-ui:preview",
  "login-ui:test",
  "login-ui:typecheck",
  "release:pack",
  "release:publish",
  "release:snapshot",
  "server:build",
  "server:lint",
  "server:test",
  "server:test-postgres",
  "server:test-spanner",
  "server:test-sqlite",
  "server:vet",
  "testing:test-integration",
  "workspace:build-local-image",
  "workspace:smoke-container",
];
const TESTING_KIT_CLASS = [
  "e2e:all",
  "e2e:console-embedded",
  "e2e:console-platform",
  "e2e:console-real",
  "e2e:demo-next-real",
  "e2e:journey",
  "e2e:journey-local",
  "e2e:typecheck",
  "release:build-public-packages",
  "release:pack",
  "release:publish",
  "release:snapshot",
  "testing:build",
  "testing:build-release",
  "testing:lint",
  "testing:test",
  "testing:test-integration",
  "testing:typecheck",
];
// Components feeds every SDK, both UIs, the CLI and every e2e lane: 96 tasks,
// correctly close to "everything".
const COMPONENTS_CLASS = [
  "cli:build",
  "cli:build-release",
  "cli:readme",
  "cli:test",
  "cli:typecheck",
  "components:build",
  "components:build-release",
  "components:install-browsers",
  "components:lint",
  "components:test",
  "components:typecheck",
  "console:build",
  "console:build-release",
  "console:dev",
  "console:dev-claim",
  "console:dev-real",
  "console:preview",
  "console:test",
  "console:typecheck",
  "demo-next:build",
  "demo-next:dev",
  "demo-next:start",
  "demo-next:typecheck",
  "demo-nuxt:build",
  "demo-nuxt:dev",
  "demo-nuxt:start",
  "demo-nuxt:typecheck",
  "e2e:all",
  "e2e:console-embedded",
  "e2e:console-platform",
  "e2e:console-real",
  "e2e:console-smoke",
  "e2e:demo-next-mock",
  "e2e:demo-next-real",
  "e2e:demo-nuxt-mock",
  "e2e:journey",
  "e2e:journey-local",
  "login-ui:build",
  "login-ui:build-release",
  "login-ui:dev",
  "login-ui:preview",
  "login-ui:test",
  "login-ui:typecheck",
  "release:build-public-packages",
  "release:pack",
  "release:publish",
  "release:snapshot",
  "sdk-angular:build",
  "sdk-angular:build-release",
  "sdk-angular:test",
  "sdk-angular:typecheck",
  "sdk-core:test",
  "sdk-core:typecheck",
  "sdk-next:build",
  "sdk-next:build-release",
  "sdk-next:test",
  "sdk-next:typecheck",
  "sdk-nuxt:build",
  "sdk-nuxt:build-release",
  "sdk-nuxt:dev",
  "sdk-nuxt:test",
  "sdk-nuxt:typecheck",
  "sdk-qwik:build",
  "sdk-qwik:build-release",
  "sdk-qwik:test",
  "sdk-qwik:typecheck",
  "sdk-react:build",
  "sdk-react:build-release",
  "sdk-react:test",
  "sdk-react:typecheck",
  "sdk-solid:build",
  "sdk-solid:build-release",
  "sdk-solid:test",
  "sdk-solid:typecheck",
  "sdk-svelte:build",
  "sdk-svelte:build-release",
  "sdk-svelte:test",
  "sdk-svelte:typecheck",
  "sdk-vue:build",
  "sdk-vue:build-release",
  "sdk-vue:test",
  "sdk-vue:typecheck",
  "server:build",
  "server:lint",
  "server:test",
  "server:test-postgres",
  "server:test-spanner",
  "server:test-sqlite",
  "server:vet",
  "storybook:build",
  "storybook:dev",
  "storybook:test",
  "storybook:typecheck",
  "testing:test-integration",
  "workspace:build-local-image",
  "workspace:smoke-container",
];
// An api-mock change reaches the suite only through the mock lanes, so no
// journey trigger moves, yet moon runs e2e:all and with it the journey.
const API_MOCK_CLASS = [
  "api-mock:build",
  "api-mock:install-browsers",
  "api-mock:lint",
  "api-mock:start",
  "api-mock:test",
  "api-mock:typecheck",
  "cli:build-release",
  "cli:test",
  "cli:typecheck",
  "components:test",
  "components:typecheck",
  "e2e:all",
  "e2e:demo-next-mock",
  "e2e:demo-nuxt-mock",
  "release:build-public-packages",
  "release:pack",
  "release:publish",
  "release:snapshot",
  "sdk-angular:test",
  "sdk-angular:typecheck",
  "sdk-qwik:test",
  "sdk-qwik:typecheck",
  "sdk-react:test",
  "sdk-react:typecheck",
  "sdk-solid:test",
  "sdk-solid:typecheck",
  "sdk-svelte:test",
  "sdk-svelte:typecheck",
  "sdk-vue:test",
  "sdk-vue:typecheck",
  "storybook:build",
  "storybook:dev",
  "storybook:test",
  "storybook:typecheck",
];
// A console spec edit: the console lanes' own inputs, not the journey's.
const CONSOLE_SPEC_CLASS = [
  "e2e:all",
  "e2e:console-deployment",
  "e2e:console-embedded",
  "e2e:console-platform",
  "e2e:console-real",
  "e2e:console-smoke",
  "e2e:lint",
  "e2e:test",
  "e2e:typecheck",
];
// A demo app edit: the demo lanes list the app they serve as an input.
const DEMO_NEXT_CLASS = [
  "demo-next:build",
  "demo-next:dev",
  "demo-next:lint",
  "demo-next:start",
  "demo-next:typecheck",
  "e2e:all",
  "e2e:demo-next-mock",
  "e2e:demo-next-real",
];

function allTrue(gates) {
  return Object.values(gates).every(Boolean);
}
function allFalse(gates) {
  return Object.values(gates).every((v) => v === false);
}
function journeys(gates) {
  return [
    gates.journey_fresh_app,
    gates.journey_passkey,
    gates.journey_preexisting,
    gates.journey_testkit,
  ];
}

test("mode: changeset/version files only is version-only", () => {
  assert.equal(computeMode([".changeset/x.md", "apps/server/package.json"]), "version-only");
  assert.equal(computeMode([".changeset/x.md", "apps/api/internal/a.go"]), "full");
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

test("go change runs everything but the mock lanes, and the journey matrix collapses to one framework", () => {
  const { gates, matrix } = resolveGates({
    mode: "full",
    files: ["apps/api/internal/a.go"],
    targets: GO_CLASS,
  });
  // The mock lanes run against api-mock, never the server.
  const { suites_mock: suitesMock, ...rest } = gates;
  assert.ok(allTrue(rest));
  assert.equal(suitesMock, false);
  assert.equal(matrix, "single");
});

test("api-mock change runs the mock lanes", () => {
  const { gates } = resolveGates({
    mode: "full",
    files: ["packages/api-mock/src/crypto.ts"],
    targets: API_MOCK_CLASS,
  });
  assert.equal(gates.suites_mock, true);
  assert.equal(gates.browsers, true);
  assert.equal(gates.suites_console, false);
});

test("console change runs everything, but the journey matrix collapses to one framework", () => {
  // The server's test binary embeds the console build, so server:test (the Go
  // signal) moves with it, and the console lanes pull in e2e:all.
  const { gates, matrix } = resolveGates({
    mode: "full",
    files: ["apps/console/src/api/zitadel.ts"],
    targets: CONSOLE_CLASS,
  });
  assert.ok(allTrue(gates));
  assert.equal(matrix, "single");
});

test("single-SDK change runs the journey on the full matrix, without the Go or real-instance suites", () => {
  // e2e:journey-local depends on every SDK build, so the journey project
  // itself is affected.
  const { gates, matrix } = resolveGates({
    mode: "full",
    files: ["packages/sdk-vue/src/index.ts"],
    targets: SDK_VUE_CLASS,
  });
  assert.deepEqual(journeys(gates), [true, true, true, true]);
  assert.equal(gates.snapshot, true);
  assert.equal(matrix, "full");
  assert.equal(gates.suites_testing_demo, false);
  assert.equal(gates.suites_console, false);
  assert.equal(gates.go_tests, false);
});

test("the nuxt SDK alone trips the pre-existing-app lane", () => {
  // Hand-made slice: sdk-nuxt:build is the one per-framework surface the
  // pre-existing lane answers to beyond the shared next-scaffold triggers (it
  // drives Next AND Nuxt widget-posture apps). The real graph also marks the
  // journey project through e2e:journey-local's SDK dependencies.
  const { gates } = resolveGates({
    mode: "full",
    files: ["packages/sdk-nuxt/src/module.ts"],
    targets: ["sdk-nuxt:build", "sdk-nuxt:test"],
  });
  assert.deepEqual(journeys(gates), [true, false, true, false]);
  assert.equal(gates.snapshot, true);
});

test("api-mock change builds the snapshot: moon runs the journey through e2e:all", () => {
  const { gates, matrix } = resolveGates({
    mode: "full",
    files: ["packages/api-mock/src/crypto.ts"],
    targets: API_MOCK_CLASS,
  });
  assert.equal(gates.snapshot, true);
  assert.deepEqual(journeys(gates), [false, false, false, false]);
  assert.equal(matrix, "single");
  assert.equal(gates.go_tests, false);
});

test("console spec edit runs the console suites and the snapshot, on one framework", () => {
  const { gates, matrix } = resolveGates({
    mode: "full",
    files: ["e2e/console/src-real/console-real.spec.ts"],
    targets: CONSOLE_SPEC_CLASS,
  });
  assert.equal(gates.suites_console, true);
  assert.equal(gates.snapshot, true);
  assert.deepEqual(journeys(gates), [false, false, false, false]);
  assert.equal(matrix, "single");
  assert.equal(gates.go_tests, false);
});

test("login-ui change runs all journeys on a single framework, and the Go tests", () => {
  // The server's test binary embeds the login UI build, so server:test moves.
  const { gates, matrix } = resolveGates({
    mode: "full",
    files: ["apps/login-ui/src/main.ts"],
    targets: LOGIN_UI_CLASS,
  });
  assert.deepEqual(journeys(gates), [true, true, true, true]);
  assert.equal(matrix, "single");
  assert.equal(gates.go_tests, true);
  assert.equal(gates.suites_console, true);
});

test("testing-kit change runs all journeys with the full matrix", () => {
  const { gates, matrix } = resolveGates({
    mode: "full",
    files: ["packages/testing/src/index.ts"],
    targets: TESTING_KIT_CLASS,
  });
  assert.deepEqual(journeys(gates), [true, true, true, true]);
  assert.equal(gates.snapshot, true);
  assert.equal(matrix, "full");
});

test("journey-project change runs all journeys, full matrix, and the snapshot that feeds them", () => {
  const { gates, matrix } = resolveGates({
    mode: "full",
    files: ["e2e/journey/src/user-journey.spec.ts"],
    targets: JOURNEY_CLASS,
  });
  assert.deepEqual(journeys(gates), [true, true, true, true]);
  assert.equal(gates.snapshot, true);
  assert.equal(matrix, "full");
  assert.equal(gates.go_tests, false);
});

test("components change runs every journey and suite with the full matrix, and the Go tests", () => {
  // Components reach the console and login UI builds the server's tests embed.
  const { gates, matrix } = resolveGates({
    mode: "full",
    files: ["packages/components/src/atoms/index.ts"],
    targets: COMPONENTS_CLASS,
  });
  assert.deepEqual(journeys(gates), [true, true, true, true]);
  assert.equal(gates.snapshot, true);
  assert.equal(gates.suites_testing_demo, true);
  assert.equal(gates.suites_console, true);
  assert.equal(gates.browsers, true);
  assert.equal(gates.go_tests, true);
  assert.equal(matrix, "full");
});

test("embedded-lane affectedness alone trips the console gate", () => {
  // Synthetic slice: a change that affects only the embedded suite (e.g. its
  // own spec files) must still schedule the console gate — the gate answers
  // to either console lane, not just e2e-real.
  const { gates } = resolveGates({
    mode: "full",
    files: ["e2e/console/src-embedded/embedded-console.spec.ts"],
    targets: ["e2e:console-embedded"],
  });
  assert.equal(gates.suites_console, true);
  assert.equal(gates.browsers, true);
  assert.equal(gates.go_tests, false);
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

test("a workflow-only edit runs the e2e step although moon selects no task", () => {
  // Probed on moon 2.6.1: a ci.yml-only diff selects nothing, an e2e/moon.yml-
  // only diff no lane. Neither file is a lane input, so only the forced run
  // puts ci.yml's e2e step (and the snapshot it needs) back on.
  for (const file of [".github/workflows/ci.yml", "e2e/moon.yml", "scripts/release-manifest.mjs"]) {
    const { gates, reason } = resolveGates({ mode: "full", files: [file], targets: [] });
    assert.match(reason, /unclaimed file/, file);
    assert.equal(gates.e2e, true, file);
    assert.equal(gates.snapshot, true, file);
  }
});

test("the e2e step follows e2e:all", () => {
  for (const [file, targets, expected] of [
    ["packages/api-mock/src/crypto.ts", API_MOCK_CLASS, true],
    ["e2e/console/src-real/console-real.spec.ts", CONSOLE_SPEC_CLASS, true],
    ["packages/sdk-vue/src/index.ts", SDK_VUE_CLASS, true],
    ["apps/demo-next/src/app/admin/page.tsx", DEMO_NEXT_CLASS, true],
    ["apps/api/internal/a.go", GO_CLASS, true],
    ["docs/adrs/001-server-cli-cobra-viper.md", DOCS_CLASS, false],
  ]) {
    const { gates, reason } = resolveGates({ mode: "full", files: [file], targets });
    assert.equal(reason, null, file);
    assert.equal(gates.e2e, expected, file);
    // The step runs the journey, which reads the snapshot.
    if (gates.e2e) assert.equal(gates.snapshot, true, file);
  }
});

test("a demo app edit runs its lanes, on one framework, without the Go suites", () => {
  // The demo lanes list the demo app as an input: they serve it, and no task
  // dependency reaches its source.
  const { gates, matrix } = resolveGates({
    mode: "full",
    files: ["apps/demo-next/src/app/admin/page.tsx"],
    targets: DEMO_NEXT_CLASS,
  });
  assert.equal(gates.e2e, true);
  assert.equal(gates.suites_mock, true);
  assert.equal(gates.suites_testing_demo, true);
  assert.deepEqual(journeys(gates), [false, false, false, false]);
  assert.equal(gates.go_tests, false);
  assert.equal(matrix, "single");
});

test("an empty diff forces a full run", () => {
  const { gates, reason } = resolveGates({ mode: "full", files: [], targets: [] });
  assert.ok(allTrue(gates));
  assert.equal(reason, "empty diff");
});

test("a failed affected query fails open", () => {
  const { gates, reason } = resolveGates({
    mode: "full",
    files: ["apps/api/internal/a.go"],
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

const moon = { runner: "moon" };

test("queryAffectedTargets parses the grouped task map", () => {
  const targets = queryAffectedTargets(
    "HEAD",
    fakeSpawn({ stdout: '{"tasks":{"server":{"test":{},"build":{}},"release":{"snapshot":{}}}}' }),
    moon,
  );
  assert.deepEqual(targets?.sort(), ["release:snapshot", "server:build", "server:test"]);
});

test("queryAffectedTargets asks moon as a local run would, against the given base", () => {
  // In CI, moon leaves runInCI false/"skip" tasks out of the affected set when
  // only their own inputs changed — the e2e lanes, which ci.yml's e2e step
  // runs anyway — so the query must not see CI (verified on moon 2.6.1: a
  // console spec edit lists e2e:console-real only without CI in the env).
  const seen = [];
  const spawn = (command, args, options) => {
    seen.push({ command, args, env: options.env });
    return { status: 0, stdout: '{"tasks":{}}', stderr: "" };
  };
  const previous = { CI: process.env.CI, GITHUB_ACTIONS: process.env.GITHUB_ACTIONS };
  process.env.CI = "true";
  process.env.GITHUB_ACTIONS = "true";
  try {
    queryAffectedTargets("abc123", spawn, moon);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].args, ["query", "tasks", "--affected", "--downstream", "deep"]);
  assert.equal(seen[0].env.MOON_BASE, "abc123");
  assert.equal(seen[0].env.MOON_HEAD, "HEAD");
  assert.equal("CI" in seen[0].env, false);
  assert.equal("GITHUB_ACTIONS" in seen[0].env, false);
});

test("queryAffectedTargets returns an empty set for an empty tasks map", () => {
  assert.deepEqual(queryAffectedTargets("HEAD", fakeSpawn({ stdout: '{"tasks":{}}' }), moon), []);
});

test("queryAffectedTargets fails open on schema drift, garbage output, and nonzero exits", () => {
  const query = (result) => queryAffectedTargets("HEAD", fakeSpawn(result), moon);
  assert.equal(query({ stdout: '{"unexpected":true}' }), null);
  assert.equal(query({ stdout: '{"tasks":[1,2]}' }), null);
  assert.equal(query({ stdout: "not json" }), null);
  assert.equal(query({ status: 1, stderr: "boom" }), null);
});

// A trimmed `turbo run … --dry=json`: inputs are relative to the task's
// package directory, dependents are task ids. The api build feeds the console
// build, which the server's tests embed; the docs check stands alone.
function turboGraph() {
  const task = (taskId, directory, inputs, dependents, command = "pnpm run x") => ({
    taskId,
    directory,
    command,
    inputs: Object.fromEntries(inputs.map((file) => [file, "hash"])),
    dependents,
  });
  return {
    globalCacheInputs: { files: { "tsconfig.base.json": "hash", "biome.json": "hash" } },
    tasks: [
      task(
        "@zitadel/api#generate",
        "packages/api",
        ["../../apps/api/api/openapi/openapi-spec.yaml"],
        ["@zitadel/api#build"],
      ),
      task("@zitadel/api#build", "packages/api", ["src/index.ts"], ["@zitadel/console#build"]),
      task("@zitadel/console#build", "apps/console", ["src/main.tsx"], ["@zitadel/server#test"]),
      task("@zitadel/server#test", "apps/server", ["../../apps/api/internal/server.go"], []),
      task("@zitadel/testing#test:integration", "packages/testing", ["src/kit.ts"], []),
      task("@zitadel/e2e#console-real", "e2e", ["console/src-real/console-real.spec.ts"], []),
      task("//#check-adrs", "", ["docs/adrs/001.md"], []),
      task("@zitadel/docs#test", "apps/docs", ["package.json"], [], "<NONEXISTENT>"),
    ],
  };
}

test("affectedTurboTargets walks dependents of the tasks whose inputs changed, not dependencies", () => {
  assert.deepEqual(affectedTurboTargets(turboGraph(), ["apps/console/src/main.tsx"]).sort(), [
    "console:build",
    "server:test",
  ]);
  assert.deepEqual(affectedTurboTargets(turboGraph(), ["apps/api/internal/server.go"]), [
    "server:test",
  ]);
  assert.deepEqual(
    affectedTurboTargets(turboGraph(), ["apps/api/api/openapi/openapi-spec.yaml"]).sort(),
    ["api:build", "api:generate", "console:build", "server:test"],
  );
});

test("affectedTurboTargets maps root tasks, colon scripts and packages without a script", () => {
  assert.deepEqual(affectedTurboTargets(turboGraph(), ["docs/adrs/001.md"]), [
    "workspace:check-adrs",
  ]);
  assert.deepEqual(affectedTurboTargets(turboGraph(), ["packages/testing/src/kit.ts"]), [
    "testing:test-integration",
  ]);
  // The e2e package's lanes land on the moon names ci-mode's gates check.
  assert.deepEqual(
    affectedTurboTargets(turboGraph(), ["e2e/console/src-real/console-real.spec.ts"]),
    ["e2e:console-real"],
  );
  // apps/docs has no test script: its placeholder task is never affected.
  assert.deepEqual(affectedTurboTargets(turboGraph(), ["apps/docs/package.json"]), []);
  assert.deepEqual(affectedTurboTargets(turboGraph(), ["README.md"]), []);
});

test("affectedTurboTargets treats a changed global input as affecting every task", () => {
  const targets = affectedTurboTargets(turboGraph(), ["biome.json"]);
  assert.equal(targets.length, 7);
  assert.ok(targets.includes("workspace:check-adrs"));
});

test("queryAffectedTargets under turbo fails open on garbage output and nonzero exits", () => {
  const query = (result, files = ["x"]) =>
    queryAffectedTargets("HEAD", fakeSpawn(result), { runner: "turbo", files });
  assert.equal(query({ stdout: "not json" }), null);
  assert.equal(query({ stdout: '{"nope":1}' }), null);
  assert.equal(query({ status: 1, stderr: "boom" }), null);
  assert.deepEqual(
    query({ stdout: JSON.stringify(turboGraph()) }, ["apps/console/src/main.tsx"]).sort(),
    ["console:build", "server:test"],
  );
});

// A trimmed `moon ci` report (.moon/cache/ciReport.json, moon 2.6.1): sync
// actions carry no target, a task's target sits under node.params.
function ciReport(...tasks) {
  return {
    actions: [
      { label: "SyncWorkspace", node: { action: "sync-workspace" }, status: "passed" },
      ...tasks.map(([target, status]) => ({
        label: `RunTask(${target})`,
        node: { action: "run-task", params: { target } },
        status,
      })),
    ],
    status: "completed",
  };
}

const DB_LANES = ["server:test-postgres", "server:test-sqlite"];

test("ranInGraph names the lanes the graph ran to a pass", () => {
  const report = ciReport(
    ["console:build", "cached"],
    ["server:test-sqlite", "passed"],
    ["server:test-postgres", "passed"],
  );
  assert.deepEqual(ranInGraph(report, DB_LANES), DB_LANES);
  assert.deepEqual(ranInGraph(report, ["server:test-postgres"]), ["server:test-postgres"]);
});

test("ranInGraph leaves out a lane the graph skipped, replayed from cache or never reached", () => {
  // Each of these sends the lane to its own step.
  const report = ciReport(["server:test-postgres", "skipped"], ["server:test-sqlite", "cached"]);
  assert.deepEqual(ranInGraph(report, DB_LANES), []);
  assert.deepEqual(ranInGraph(ciReport(["server:test", "passed"]), DB_LANES), []);
});

test("no readable ci report counts as a graph that ran nothing", () => {
  // `moon ci` writes no report when it finds no task affected, as on a run
  // forced full by a workflow-only diff (run 38509559030): its own steps are
  // then the lanes' only run.
  const dir = mkdtempSync(join(tmpdir(), "ci-mode-"));
  assert.equal(readCiReport(join(dir, "ciReport.json")), null);
  writeFileSync(join(dir, "garbage.json"), "not json");
  assert.equal(readCiReport(join(dir, "garbage.json")), null);
  assert.deepEqual(ranInGraph(null, DB_LANES), []);
  assert.deepEqual(ranInGraph({ actions: "garbage" }, DB_LANES), []);

  const report = ciReport(["server:test-postgres", "passed"]);
  writeFileSync(join(dir, "report.json"), JSON.stringify(report));
  assert.deepEqual(readCiReport(join(dir, "report.json")), report);
});
