import assert from "node:assert/strict";
import { test } from "vitest";

import {
  appPortFromUrl,
  ciExcludedFrameworkIds,
  ciFrameworkIds,
  frameworkForId,
  frameworkIds,
  frameworks,
} from "./frameworks.mjs";

test("the CI matrix skips the meta-frameworks whose scaffolders track upstream releases", () => {
  assert.deepEqual(ciExcludedFrameworkIds, [
    "sveltekit",
    "tanstack-start",
    "solid-start",
    "qwik-city",
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
      "qwik-city",
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
  ["qwik-city", true],
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
