/* oxlint-disable playwright/expect-expect */
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseLocalJourneyArgs } from "./run-options.mjs";

test("local journey defaults to the full framework matrix", () => {
  assert.deepEqual(parseLocalJourneyArgs([]), {
    concurrency: 1,
    frameworkIds: ["next", "nuxt", "react", "vue", "angular", "solid", "svelte", "qwik"],
    image: "",
    keep: false,
    runtime: "binary",
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
      "--work-dir",
      "/tmp/journey",
    ]),
    {
      concurrency: 2,
      frameworkIds: ["vue"],
      image: "nextgen:test",
      keep: true,
      runtime: "docker",
      workDir: "/tmp/journey",
    },
  );
});

test("local journey can request the binary runtime explicitly", () => {
  assert.deepEqual(parseLocalJourneyArgs(["--runtime", "binary", "--framework", "next"]), {
    concurrency: 1,
    frameworkIds: ["next"],
    image: "",
    keep: false,
    runtime: "binary",
    workDir: "",
  });
});

test("local journey rejects invalid options", () => {
  assert.throws(() => parseLocalJourneyArgs(["--framework", "ember"]), /unsupported/);
  assert.throws(() => parseLocalJourneyArgs(["--concurrency", "0"]), /positive integer/);
  assert.throws(() => parseLocalJourneyArgs(["--image"]), /requires a value/);
  assert.throws(() => parseLocalJourneyArgs(["--runtime", "podman"]), /binary or docker/);
  assert.throws(() => parseLocalJourneyArgs(["--image", "test", "--runtime", "binary"]), /requires --runtime docker/);
  assert.throws(() => parseLocalJourneyArgs(["--unknown"]), /unknown argument/);
});
