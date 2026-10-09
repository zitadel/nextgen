import assert from "node:assert/strict";
import { test } from "vitest";

import { parseLocalJourneyArgs } from "./run-options.mjs";

test("local journey defaults to the full framework matrix", () => {
  assert.deepEqual(parseLocalJourneyArgs([]), {
    ci: false,
    concurrency: 5,
    frameworkIds: [
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
    image: "",
    keep: false,
    matrix: "full",
    preexistingApp: false,
    preset: "",
    runtime: "binary",
    suite: "frameworks",
    tarballsDir: "",
    workDir: "",
  });
});

test("local journey can select one framework and tune concurrency", () => {
  assert.deepEqual(
    parseLocalJourneyArgs([
      "--framework",
      "vue",
      "--concurrency",
      "2",
      "--image",
      "nextgen:test",
      "--keep",
      "--tarballs-dir",
      "/tmp/tarballs",
      "--work-dir",
      "/tmp/journey",
    ]),
    {
      ci: false,
      concurrency: 2,
      frameworkIds: ["vue"],
      image: "nextgen:test",
      keep: true,
      matrix: "full",
      preexistingApp: false,
      preset: "",
      runtime: "docker",
      suite: "frameworks",
      tarballsDir: "/tmp/tarballs",
      workDir: "/tmp/journey",
    },
  );
});

test("local journey can scaffold with a sign-in preset", () => {
  assert.deepEqual(parseLocalJourneyArgs(["--framework", "next", "--preset", "passkey-first"]), {
    ci: false,
    concurrency: 5,
    frameworkIds: ["next"],
    image: "",
    keep: false,
    matrix: "full",
    preexistingApp: false,
    preset: "passkey-first",
    runtime: "binary",
    suite: "frameworks",
    tarballsDir: "",
    workDir: "",
  });
  assert.throws(() => parseLocalJourneyArgs(["--preset"]), /requires a value/);
});

test("the testkit suite pins the next framework and rejects an explicit one", () => {
  assert.deepEqual(parseLocalJourneyArgs(["--suite", "testkit"]), {
    ci: false,
    concurrency: 5,
    frameworkIds: ["next"],
    image: "",
    keep: false,
    matrix: "full",
    preexistingApp: false,
    preset: "",
    runtime: "binary",
    suite: "testkit",
    tarballsDir: "",
    workDir: "",
  });
  assert.throws(
    () => parseLocalJourneyArgs(["--suite", "testkit", "--framework", "next"]),
    /drop --framework/,
  );
  assert.throws(() => parseLocalJourneyArgs(["--suite", "everything"]), /frameworks or testkit/);
});

test("local journey can request the binary runtime explicitly", () => {
  assert.deepEqual(parseLocalJourneyArgs(["--runtime", "binary", "--framework", "next"]), {
    ci: false,
    concurrency: 5,
    frameworkIds: ["next"],
    image: "",
    keep: false,
    matrix: "full",
    preexistingApp: false,
    preset: "",
    runtime: "binary",
    suite: "frameworks",
    tarballsDir: "",
    workDir: "",
  });
});

test("the pre-existing-app lane defaults to the route-based matrix", () => {
  // No explicit framework: the lane runs exactly the ADR 044 posture scope.
  assert.deepEqual(parseLocalJourneyArgs(["--preexisting-app"]).frameworkIds, ["next", "nuxt"]);
  assert.equal(parseLocalJourneyArgs(["--preexisting-app"]).preexistingApp, true);
  // An explicit route-based framework narrows the lane.
  assert.deepEqual(
    parseLocalJourneyArgs(["--preexisting-app", "--framework", "nuxt"]).frameworkIds,
    ["nuxt"],
  );
  // SPA families keep the page posture (ADR 044) — the lane refuses them.
  assert.throws(
    () => parseLocalJourneyArgs(["--preexisting-app", "--framework", "react"]),
    /route-based frameworks/,
  );
  assert.throws(
    () => parseLocalJourneyArgs(["--suite", "testkit", "--preexisting-app"]),
    /testkit suite always scaffolds fresh/,
  );
});

test("--ci runs the full CI journey set in one process", () => {
  const parsed = parseLocalJourneyArgs(["--ci"]);
  assert.equal(parsed.ci, true);
  assert.equal(parsed.matrix, "full");
});

test("--matrix validates its scope", () => {
  assert.equal(parseLocalJourneyArgs(["--ci", "--matrix", "single"]).matrix, "single");
  assert.equal(parseLocalJourneyArgs(["--ci", "--matrix", "full"]).matrix, "full");
  assert.throws(() => parseLocalJourneyArgs(["--matrix", "half"]), /single or full/);
  assert.throws(() => parseLocalJourneyArgs(["--matrix"]), /requires a value/);
});

test("--matrix without --ci is rejected rather than silently ignored", () => {
  assert.throws(
    () => parseLocalJourneyArgs(["--matrix", "single"]),
    /--matrix only applies with --ci/,
  );
});

test("--ci rejects the flags that pick a single variant's shape", () => {
  assert.throws(
    () => parseLocalJourneyArgs(["--ci", "--framework", "next"]),
    /--ci runs the full CI journey set/,
  );
  assert.throws(
    () => parseLocalJourneyArgs(["--ci", "--suite", "testkit"]),
    /--ci runs the full CI journey set/,
  );
  assert.throws(
    () => parseLocalJourneyArgs(["--ci", "--preset", "passkey-first"]),
    /--ci runs the full CI journey set/,
  );
  assert.throws(
    () => parseLocalJourneyArgs(["--ci", "--preexisting-app"]),
    /--ci runs the full CI journey set/,
  );
});

test("local journey rejects invalid options", () => {
  assert.throws(() => parseLocalJourneyArgs(["--framework", "ember"]), /unsupported/);
  assert.throws(() => parseLocalJourneyArgs(["--concurrency", "0"]), /positive integer/);
  assert.throws(() => parseLocalJourneyArgs(["--image"]), /requires a value/);
  assert.throws(() => parseLocalJourneyArgs(["--tarballs-dir"]), /requires a value/);
  assert.throws(() => parseLocalJourneyArgs(["--runtime", "podman"]), /binary or docker/);
  assert.throws(
    () => parseLocalJourneyArgs(["--image", "test", "--runtime", "binary"]),
    /requires --runtime docker/,
  );
  assert.throws(() => parseLocalJourneyArgs(["--unknown"]), /unknown argument/);
});
