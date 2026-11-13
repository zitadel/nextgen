import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

import {
  appPortFromUrl,
  ciExcludedFrameworkIds,
  ciFrameworkIds,
  ciJourneyIds,
  ciJourneyVariants,
  frameworkForId,
  frameworkIds,
  frameworks,
} from "./frameworks.mjs";
import { journeyBuildTasks, journeyPackageDirs, sharedPackageDirs } from "./journey-packages.mjs";

test("the CI matrix skips the meta-frameworks whose scaffolders track upstream releases", () => {
  assert.deepEqual(ciExcludedFrameworkIds, [
    "sveltekit",
    "tanstack-start",
    "solid-start",
    "qwik-router",
  ]);
  assert.deepEqual(ciFrameworkIds, [
    "next",
    "nuxt",
    "react",
    "vue",
    "angular",
    "solid",
    "svelte",
    "qwik",
  ]);
  // Excluded from CI, not removed: each stays a registered target that can be run by hand.
  for (const id of ciExcludedFrameworkIds) {
    assert.equal(frameworkForId(id).id, id);
  }
});

test("framework registry lists every CLI journey target", () => {
  assert.deepEqual(
    frameworks.map((framework) => framework.id),
    [
      "next",
      "nuxt",
      "react",
      "vue",
      "angular",
      "solid",
      "svelte",
      "qwik",
      "sveltekit",
      "tanstack-start",
      "solid-start",
      "qwik-router",
    ],
  );
  assert.deepEqual(
    frameworkIds,
    frameworks.map((framework) => framework.id),
  );
  for (const framework of frameworks) {
    assert.match(framework.sdkPackageDir, /^packages\/sdk-/);
    assert.equal(framework.readyPath, "/login");
    assert.deepEqual(framework.devServerArgs(3100).slice(0, 3), ["run", "dev", "--"]);
  }
});

// Every framework with a server SDK guards /profile; the SPA families have no
// server to redirect from. The user journey reads this flag to decide whether
// it asserts the redirect.
test.each([
  ["next", true],
  ["nuxt", true],
  ["sveltekit", true],
  ["tanstack-start", true],
  ["solid-start", true],
  ["qwik-router", true],
  ["react", false],
  ["vue", false],
  ["angular", false],
  ["solid", false],
  ["svelte", false],
  ["qwik", false],
])("framework registry expects %s to redirect protected routes: %s", (id, expected) => {
  assert.equal(frameworkForId(id).expectsProtectedRouteRedirect, expected);
});

test("frameworkForId rejects unsupported frameworks", () => {
  assert.throws(() => frameworkForId("ember"), /unsupported journey framework/);
});

test("appPortFromUrl derives explicit and default ports", () => {
  assert.equal(appPortFromUrl("http://localhost:4321"), 4321);
  assert.equal(appPortFromUrl("http://localhost"), 80);
  assert.equal(appPortFromUrl("https://localhost"), 443);
});

// CI runs the `--ci` set as one turbo task per journey; a journey with no task
// would never run, and nothing else would notice.
test("every CI journey has a journey:<id> task that journey-local runs", () => {
  const e2e = new URL("../../", import.meta.url);
  const { scripts } = JSON.parse(readFileSync(new URL("package.json", e2e), "utf8"));
  const tasks = Object.entries(scripts).filter(([name]) => name.startsWith("journey:"));
  assert.deepEqual(
    tasks.map(([, script]) => script.match(/--only (\S+)/)?.[1]).sort(),
    [...ciJourneyIds].sort(),
  );
  const umbrella = readFileSync(new URL("turbo.json", e2e), "utf8").match(
    /"journey-local": \{[^}]*"dependsOn": \[([^\]]*)\]/,
  );
  assert.deepEqual(
    [...umbrella[1].matchAll(/"([^"]+)"/g)].map(([, name]) => name).sort(),
    tasks.map(([name]) => name).sort(),
  );
  // CI names each journey: through the umbrella, `--affected` would run all
  // of them once any one is affected.
  const ci = JSON.parse(readFileSync(new URL("../package.json", e2e), "utf8")).scripts.ci.split(
    /\s+/,
  );
  for (const [name] of tasks) {
    assert.ok(ci.includes(name), `the root ci script does not name ${name}`);
  }
  assert.ok(
    !ci.includes("journey-local"),
    "the root ci script runs every journey via journey-local",
  );
});

// A journey's registry serves only what it installs, packed from the builds
// its task depends on: a missing edge would let `--affected` skip the
// journey when that package changes, or pack a stale dist.
test("every CI journey's task depends on the builds of exactly what it installs", () => {
  const e2e = new URL("../../", import.meta.url);
  const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const { scripts } = JSON.parse(readFileSync(new URL("package.json", e2e), "utf8"));
  const turbo = readFileSync(new URL("turbo.json", e2e), "utf8");
  const edges = (task) => {
    const match = turbo.match(new RegExp(`"${task}": \\{[^}]*"dependsOn": \\[([^\\]]*)\\]`));
    assert.ok(match, `${task} has no dependsOn in e2e/turbo.json`);
    return [...match[1].matchAll(/"([^"]+)"/g)].map(([, name]) => name);
  };
  const shared = edges("journey-packages");
  // journey-packages packs exactly what it builds.
  assert.deepEqual(shared, journeyBuildTasks(sharedPackageDirs(repoRoot)));
  const tasks = Object.entries(scripts).filter(([name]) => name.startsWith("journey:"));
  assert.equal(tasks.length, ciJourneyIds.length);
  for (const [task, script] of tasks) {
    const [variantId, frameworkId] = script.match(/--only (\S+)/)[1].split("/");
    const variant = ciJourneyVariants().find(({ id }) => id === variantId);
    const run = { variant, framework: frameworkForId(frameworkId) };
    const [base, packages, ...own] = edges(task);
    assert.deepEqual([base, packages], ["journey-base", "journey-packages"], task);
    assert.deepEqual(
      [...new Set([...shared, ...own])].sort(),
      journeyBuildTasks(journeyPackageDirs(repoRoot, [run])),
      task,
    );
  }
});
