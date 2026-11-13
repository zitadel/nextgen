/**
 * Tests for the comparisons `//#check-go-work` runs before the check
 * itself (Vitest, no Go): which modules a module's own build and the
 * workspace's load at different versions, and the go.work.sum check's helpers.
 */
import assert from "node:assert/strict";
import { test } from "vitest";

import { relocatedGoWork, sumChanges, TAG_SETS, versionDifferences } from "./check-go-work.mjs";

const versions = (entries) => new Map(Object.entries(entries));

test("a module the workspace raises is a difference", () => {
  assert.deepEqual(
    versionDifferences(
      versions({ "google.golang.org/grpc": "v1.83.2", "golang.org/x/net": "v0.60.0" }),
      versions({ "google.golang.org/grpc": "v1.84.0", "golang.org/x/net": "v0.60.0" }),
      new Set(),
    ),
    [{ path: "google.golang.org/grpc", own: "v1.83.2", workspace: "v1.84.0" }],
  );
});

test("the workspace's own modules are skipped", () => {
  // Outside the workspace a replace directive resolves them at the required
  // version; inside it they have none.
  assert.deepEqual(
    versionDifferences(
      versions({ "go.zitadel.com/zitadel/v5": "v5.0.0" }),
      versions({ "go.zitadel.com/zitadel/v5": "" }),
      new Set(["go.zitadel.com/zitadel/v5"]),
    ),
    [],
  );
});

test("a module only one build loads is not a version difference", () => {
  assert.deepEqual(
    versionDifferences(versions({ "golang.org/x/sys": "v0.48.0" }), versions({}), new Set()),
    [],
  );
});

test("differences are sorted by module path", () => {
  const own = versions({ "z.example/b": "v1.0.0", "a.example/a": "v1.0.0" });
  const workspace = versions({ "z.example/b": "v1.1.0", "a.example/a": "v1.1.0" });
  assert.deepEqual(
    versionDifferences(own, workspace, new Set()).map(({ path }) => path),
    ["a.example/a", "z.example/b"],
  );
});

test("each integration lane loads on its own", () => {
  // Every lane has a TestMain of its own: two lanes' tags together fail to load.
  for (const tags of TAG_SETS) {
    assert.ok(tags.filter((tag) => tag.endsWith("_integration")).length <= 1, tags.join(","));
  }
});

test("a relocated go.work resolves its local paths from the workspace root", () => {
  const work = {
    Go: "1.26.0",
    Toolchain: "go1.26.9",
    Godebug: [{ Key: "http2client", Value: "0" }],
    Use: [{ DiskPath: "./apps/api" }, { DiskPath: "/abs/tools/bench" }],
    Replace: [
      { Old: { Path: "example.com/a" }, New: { Path: "../a" } },
      {
        Old: { Path: "example.com/b", Version: "v1.0.0" },
        New: { Path: "example.com/c", Version: "v1.1.0" },
      },
    ],
  };
  assert.equal(
    relocatedGoWork(work, "/repo"),
    [
      "go 1.26.0",
      "toolchain go1.26.9",
      "godebug http2client=0",
      'use "/repo/apps/api"',
      'use "/abs/tools/bench"',
      'replace example.com/a => "/a"',
      "replace example.com/b v1.0.0 => example.com/c v1.1.0",
      "",
    ].join("\n"),
  );
});

test("sum changes list the lines Go adds and drops", () => {
  assert.deepEqual(sumChanges("a h1:1\nb h1:2\n", "b h1:2\nc h1:3\n"), {
    added: ["c h1:3"],
    removed: ["a h1:1"],
  });
});
