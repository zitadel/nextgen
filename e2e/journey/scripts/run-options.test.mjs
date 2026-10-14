import assert from "node:assert/strict";
import { test } from "vitest";

import {
  assertPrebuiltTarballsOnGitHub,
  journeyArgsFromEnv,
  parseLocalJourneyArgs,
} from "./run-options.mjs";

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
    remote: false,
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
      remote: false,
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
    remote: false,
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
    remote: false,
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
    remote: false,
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
  assert.throws(
    () => parseLocalJourneyArgs(["--ci", "--remote"]),
    /--ci runs the full CI journey set/,
  );
});

test("--remote sets up a frameworks lane against the https edge", () => {
  const parsed = parseLocalJourneyArgs([
    "--framework",
    "vue",
    "--preset",
    "passkey-first",
    "--remote",
  ]);
  assert.equal(parsed.remote, true);
  assert.deepEqual(parsed.frameworkIds, ["vue"]);
  assert.equal(parsed.preset, "passkey-first");
});

test("--remote is rejected for the testkit suite, which boots its own instance", () => {
  assert.throws(
    () => parseLocalJourneyArgs(["--suite", "testkit", "--remote"]),
    /--remote applies to the frameworks suite only/,
  );
});

test("the JOURNEY_* variables stand for the options CI sets", () => {
  assert.deepEqual(
    journeyArgsFromEnv({
      JOURNEY_CI: "1",
      JOURNEY_MATRIX: "single",
      JOURNEY_RUNTIME: "binary",
      JOURNEY_TARBALLS_DIR: "dist/release/1.0.0/npm",
      JOURNEY_WORK_DIR: "/tmp/ci-journey",
    }),
    [
      "--ci",
      "--matrix",
      "single",
      "--runtime",
      "binary",
      "--tarballs-dir",
      "dist/release/1.0.0/npm",
      "--work-dir",
      "/tmp/ci-journey",
    ],
  );
  assert.deepEqual(journeyArgsFromEnv({ JOURNEY_CI: "0", JOURNEY_MATRIX: "" }), []);
});

test("the command line's arguments win over the JOURNEY_* variables", () => {
  const parsed = parseLocalJourneyArgs([
    ...journeyArgsFromEnv({ JOURNEY_CI: "1", JOURNEY_WORK_DIR: "/tmp/from-env" }),
    "--work-dir",
    "/tmp/from-args",
  ]);
  assert.equal(parsed.ci, true);
  assert.equal(parsed.workDir, "/tmp/from-args");
});

test("in GitHub Actions the journey refuses to pack its own tarballs", () => {
  const ci = parseLocalJourneyArgs(["--ci"]);
  assert.throws(
    () => assertPrebuiltTarballsOnGitHub(ci, { GITHUB_RUN_ID: "1" }),
    /prebuilt tarballs/,
  );
  const handedOver = parseLocalJourneyArgs([
    ...journeyArgsFromEnv({ JOURNEY_TARBALLS_DIR: "dist/release/1.0.0/npm" }),
    "--ci",
  ]);
  assert.doesNotThrow(() => assertPrebuiltTarballsOnGitHub(handedOver, { GITHUB_RUN_ID: "1" }));
  // Run by hand, the runner still packs its own.
  assert.doesNotThrow(() => assertPrebuiltTarballsOnGitHub(ci, {}));
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
