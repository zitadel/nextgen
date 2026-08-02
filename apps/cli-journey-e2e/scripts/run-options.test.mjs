/* oxlint-disable playwright/expect-expect */
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseLocalJourneyArgs } from "./run-options.mjs";

test("local journey defaults to the full framework matrix", () => {
  assert.deepEqual(parseLocalJourneyArgs([]), {
    concurrency: 5,
    frameworkIds: ["next", "nuxt", "react", "vue", "angular", "solid", "svelte", "qwik"],
    image: "",
    keep: false,
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
      concurrency: 2,
      frameworkIds: ["vue"],
      image: "nextgen:test",
      keep: true,
      preset: "",
      runtime: "docker",
      suite: "frameworks",
      tarballsDir: "/tmp/tarballs",
      workDir: "/tmp/journey",
    },
  );
});

test("local journey can scaffold with a sign-in preset", () => {
  assert.deepEqual(
    parseLocalJourneyArgs(["--framework", "next", "--preset", "passkey-first"]),
    {
      concurrency: 5,
      frameworkIds: ["next"],
      image: "",
      keep: false,
      preset: "passkey-first",
      runtime: "binary",
      suite: "frameworks",
      tarballsDir: "",
      workDir: "",
    },
  );
  assert.throws(() => parseLocalJourneyArgs(["--preset"]), /requires a value/);
});

test("the testkit suite pins the next framework and rejects an explicit one", () => {
  assert.deepEqual(parseLocalJourneyArgs(["--suite", "testkit"]), {
    concurrency: 5,
    frameworkIds: ["next"],
    image: "",
    keep: false,
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
    concurrency: 5,
    frameworkIds: ["next"],
    image: "",
    keep: false,
    preset: "",
    runtime: "binary",
    suite: "frameworks",
    tarballsDir: "",
    workDir: "",
  });
});

test("local journey rejects invalid options", () => {
  assert.throws(() => parseLocalJourneyArgs(["--framework", "ember"]), /unsupported/);
  assert.throws(() => parseLocalJourneyArgs(["--concurrency", "0"]), /positive integer/);
  assert.throws(() => parseLocalJourneyArgs(["--image"]), /requires a value/);
  assert.throws(() => parseLocalJourneyArgs(["--tarballs-dir"]), /requires a value/);
  assert.throws(() => parseLocalJourneyArgs(["--runtime", "podman"]), /binary or docker/);
  assert.throws(() => parseLocalJourneyArgs(["--image", "test", "--runtime", "binary"]), /requires --runtime docker/);
  assert.throws(() => parseLocalJourneyArgs(["--unknown"]), /unknown argument/);
});
