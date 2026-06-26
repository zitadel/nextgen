import { describe, expect, it } from "vitest";

import type {
  FileOp,
  ScaffoldPlan,
} from "../../../../../../../src/lib/orca/patchers/rule/file-writer/types";
import { TanStackStartPatcher } from "../../../../../../../src/lib/orca/patchers/rule/tanstack-start";
import type { PatchContext } from "../../../../../../../src/lib/orca/patchers/types";
import { MANAGED_MARKER } from "../../../../../../../src/lib/paths";

function ctx(appDir = "src"): PatchContext {
  return {
    framework: { id: "tanstack-start", appDir, devPort: 3000, url: "http://localhost:3000" },
    rendererId: "react",
    project: {
      id: "proj-1",
      projectSecret: "sk_full",
      previewSecret: "sk_preview",
      previewOrigins: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    issuer: "http://localhost:3000",
    server: "https://api.zitadel.cloud",
    cliVersion: "0.1.0-alpha.0",
  };
}

function writeContents(plan: ScaffoldPlan, path: string): string | undefined {
  const op = plan.ops.find(
    (candidate): candidate is Extract<FileOp, { kind: "write" }> =>
      candidate.kind === "write" && candidate.path === path,
  );
  return op?.contents;
}

describe("TanStackStartPatcher.plan", () => {
  it("writes the request-middleware start entry and file-based routes under src/", () => {
    const plan = new TanStackStartPatcher().plan(ctx());

    expect(writeContents(plan, "src/start.ts")).toContain(MANAGED_MARKER);
    expect(writeContents(plan, "src/start.ts")).toContain("@zitadel/sdk-tanstack-start/server");
    expect(writeContents(plan, "src/start.ts")).toContain("createNextgenRequestMiddleware");
    // src/start.ts is TanStack's reserved server entry: it must export a
    // `startInstance` from `createStart`, not call `registerGlobalMiddleware`.
    expect(writeContents(plan, "src/start.ts")).toContain("createStart");
    expect(writeContents(plan, "src/start.ts")).toContain("export const startInstance");

    expect(writeContents(plan, "src/routes/index.tsx")).toContain(MANAGED_MARKER);
    expect(writeContents(plan, "src/routes/login.tsx")).toContain(MANAGED_MARKER);
    expect(writeContents(plan, "src/routes/login.tsx")).toContain(
      "@zitadel/sdk-tanstack-start/react",
    );
    expect(writeContents(plan, "src/routes/login.tsx")).toContain('purpose="login"');
    expect(writeContents(plan, "src/routes/register.tsx")).toContain('purpose="register"');
    expect(writeContents(plan, "src/routes/profile.tsx")).toContain("ZitadelLogout");
    expect(writeContents(plan, "src/routes/login.tsx")).toContain("#0f0f11");
  });

  it("seeds the public project id and no other config edit", () => {
    const plan = new TanStackStartPatcher().plan(ctx());
    const envOp = plan.ops.find(
      (op): op is Extract<FileOp, { kind: "merge-env" }> =>
        op.kind === "merge-env" &&
        op.path === ".env.local" &&
        "VITE_ZITADEL_PROJECT_ID" in op.entries,
    );
    expect(envOp?.entries).toMatchObject({ VITE_ZITADEL_PROJECT_ID: "proj-1" });
    expect(plan.ops.some((op) => op.kind === "edit")).toBe(false);
  });

  it("adds the SDK dependency at the CLI's prerelease tag", () => {
    const dep = new TanStackStartPatcher()
      .plan(ctx())
      .ops.find((op): op is Extract<FileOp, { kind: "add-dep" }> => op.kind === "add-dep");
    expect(dep).toMatchObject({ name: "@zitadel/sdk-tanstack-start", version: "alpha" });
  });
});

describe("TanStackStartPatcher.artifacts", () => {
  it("lists the routes + start entry as managed, the SDK as a dependency, no config edits", () => {
    const artifacts = new TanStackStartPatcher().artifacts({
      framework: {
        id: "tanstack-start",
        appDir: "src",
        devPort: 3000,
        url: "http://localhost:3000",
      },
      rendererId: "react",
    });
    expect(artifacts.markedFiles).toContain("src/start.ts");
    expect(artifacts.markedFiles).toContain("src/routes/login.tsx");
    expect(artifacts.dependencies).toEqual(["@zitadel/sdk-tanstack-start"]);
    expect(artifacts.configEdits).toEqual([]);
  });
});

describe("TanStackStartPatcher.canPatch", () => {
  it("matches tanstack-start only", () => {
    const patcher = new TanStackStartPatcher();
    expect(patcher.canPatch("tanstack-start")).toBe(true);
    expect(patcher.canPatch("react")).toBe(false);
  });
});
