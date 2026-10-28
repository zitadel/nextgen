import assert from "node:assert/strict";
import { test } from "vitest";

import {
  buildExcludedFiles,
  claimedFiles,
  outcomes,
  unclaimedFiles,
} from "./check-turbo-hermetic.mjs";

// A trimmed `turbo run … --dry=json`: inputs relative to the package.
const dry = {
  globalCacheInputs: { files: { "tsconfig.base.json": "hash" } },
  tasks: [
    { taskId: "@z/lib#build", task: "build", directory: "lib", inputs: { "src/index.ts": "h" } },
    {
      taskId: "@z/lib#test",
      task: "test",
      directory: "lib",
      inputs: { "src/index.ts": "h", "src/index.test.ts": "h", "../docs/fixture.md": "h" },
    },
    {
      taskId: "@z/lib#lint",
      task: "lint",
      directory: "lib",
      command: "<NONEXISTENT>",
      inputs: { "README.md": "h" },
    },
    {
      taskId: "//#check-adrs",
      task: "check-adrs",
      directory: "",
      inputs: { "docs/adrs/001.md": "h" },
    },
  ],
};
const tracked = [
  "tsconfig.base.json",
  "turbo.json",
  "lib/package.json",
  "lib/turbo.json",
  "lib/README.md",
  "lib/src/index.ts",
  "lib/src/index.test.ts",
  "docs/fixture.md",
  "docs/adrs/001.md",
  "docs/runbooks/cloud.md",
  ".github/workflows/ci.yml",
];

test("claimedFiles is every real task's inputs and the global dependencies", () => {
  assert.deepEqual([...claimedFiles(dry)].sort(), [
    "docs/adrs/001.md",
    "docs/fixture.md",
    "lib/src/index.test.ts",
    "lib/src/index.ts",
    "tsconfig.base.json",
  ]);
});

test("unclaimedFiles keeps what turbo, git and pnpm read themselves", () => {
  assert.deepEqual(unclaimedFiles(tracked, claimedFiles(dry)), [
    "lib/README.md",
    "docs/runbooks/cloud.md",
    ".github/workflows/ci.yml",
  ]);
});

test("buildExcludedFiles is what the builds leave out of their inputs", () => {
  assert.deepEqual(buildExcludedFiles(dry, tracked), ["lib/README.md", "lib/src/index.test.ts"]);
  // Another package's build reads lib's README, so it stays.
  const site = {
    taskId: "@z/site#build",
    task: "build",
    directory: "site",
    inputs: { "../lib/README.md": "h" },
  };
  const withSite = { ...dry, tasks: [...dry.tasks, site] };
  assert.deepEqual(buildExcludedFiles(withSite, tracked), ["lib/src/index.test.ts"]);
});

test("outcomes names the failed and the never-run tasks of the given kinds", () => {
  const summary = {
    tasks: [
      { taskId: "@z/lib#build", task: "build", execution: { exitCode: 0 } },
      { taskId: "@z/app#build", task: "build", execution: { exitCode: 1 } },
      { taskId: "@z/docs#build", task: "build" },
      { taskId: "@z/docs#typecheck", task: "typecheck", execution: { exitCode: 2 } },
    ],
  };
  assert.deepEqual(outcomes(summary, new Set(["build"])), {
    failed: ["@z/app#build"],
    unverified: ["@z/docs#build"],
  });
});
