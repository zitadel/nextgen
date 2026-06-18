/* oxlint-disable playwright/expect-expect */
import assert from "node:assert/strict";
import { test } from "node:test";

import { appPortFromUrl, frameworkForId, frameworkIds, frameworks } from "./frameworks.mjs";

test("framework registry lists every CLI journey target", () => {
  assert.deepEqual(
    frameworks.map((framework) => framework.id),
    ["next", "nuxt", "react", "vue", "angular"],
  );
  assert.deepEqual(frameworkIds, frameworks.map((framework) => framework.id));
  for (const framework of frameworks) {
    assert.match(framework.sdkPackageDir, /^packages\/sdk-/);
    assert.equal(framework.readyPath, "/login");
    assert.deepEqual(framework.devServerArgs(3100).slice(0, 3), ["run", "dev", "--"]);
  }
});

test("framework registry captures protected-route expectations", () => {
  assert.equal(frameworkForId("next").expectsProtectedRouteRedirect, true);
  assert.equal(frameworkForId("nuxt").expectsProtectedRouteRedirect, true);
  assert.equal(frameworkForId("react").expectsProtectedRouteRedirect, false);
  assert.equal(frameworkForId("vue").expectsProtectedRouteRedirect, false);
  assert.equal(frameworkForId("angular").expectsProtectedRouteRedirect, false);
});

test("frameworkForId rejects unsupported frameworks", () => {
  assert.throws(() => frameworkForId("svelte"), /unsupported journey framework/);
});

test("appPortFromUrl derives explicit and default ports", () => {
  assert.equal(appPortFromUrl("http://localhost:4321"), 4321);
  assert.equal(appPortFromUrl("http://localhost"), 80);
  assert.equal(appPortFromUrl("https://localhost"), 443);
});
