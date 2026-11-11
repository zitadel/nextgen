/**
 * Tests for the comparison `workspace:check-go-work` runs before the check
 * itself (Vitest, no Go): which modules a module's own build and the
 * workspace's load at different versions.
 */
import assert from "node:assert/strict";
import { test } from "vitest";

import { TAG_SETS, versionDifferences } from "./check-go-work.mjs";

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
