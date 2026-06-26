import { describe, expect, it } from "vitest";

import type {
  FileOp,
  ScaffoldPlan,
} from "../../../../../../../src/lib/orca/patchers/rule/file-writer/types";
import { SolidStartPatcher } from "../../../../../../../src/lib/orca/patchers/rule/solid-start";
import type { PatchContext } from "../../../../../../../src/lib/orca/patchers/types";
import { MANAGED_MARKER } from "../../../../../../../src/lib/paths";

function ctx(appDir = "src"): PatchContext {
  return {
    framework: { id: "solid-start", appDir, devPort: 3000, url: "http://localhost:3000" },
    rendererId: "solid",
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

describe("SolidStartPatcher.plan", () => {
  it("writes the middleware and file-based routes under src/", () => {
    const plan = new SolidStartPatcher().plan(ctx());

    expect(writeContents(plan, "src/middleware.ts")).toContain(MANAGED_MARKER);
    expect(writeContents(plan, "src/middleware.ts")).toContain("@zitadel/sdk-solid-start/server");
    expect(writeContents(plan, "src/middleware.ts")).toContain("createNextgenMiddleware");

    expect(writeContents(plan, "src/routes/index.tsx")).toContain(MANAGED_MARKER);
    expect(writeContents(plan, "src/routes/login.tsx")).toContain('purpose="login"');
    expect(writeContents(plan, "src/routes/register.tsx")).toContain('purpose="register"');
    expect(writeContents(plan, "src/routes/profile.tsx")).toContain("ZitadelLogout");
    expect(writeContents(plan, "src/routes/login.tsx")).toContain("background:#0f0f11");
    expect(writeContents(plan, "src/routes/login.tsx")).toContain("@zitadel/sdk-solid");
    expect(writeContents(plan, "src/routes/login.tsx")).toContain("ZitadelLogin");
  });

  it("seeds the public project id and edits vite.config", () => {
    const plan = new SolidStartPatcher().plan(ctx());
    const envOp = plan.ops.find(
      (op): op is Extract<FileOp, { kind: "merge-env" }> =>
        op.kind === "merge-env" &&
        op.path === ".env.local" &&
        "VITE_ZITADEL_PROJECT_ID" in op.entries,
    );
    expect(envOp?.entries).toMatchObject({ VITE_ZITADEL_PROJECT_ID: "proj-1" });

    const edit = plan.ops.find((op): op is Extract<FileOp, { kind: "edit" }> => op.kind === "edit");
    expect(edit?.path).toContain("vite.config.ts");
  });

  it("adds the SDK + component dependencies at the CLI's prerelease tag", () => {
    const deps = new SolidStartPatcher()
      .plan(ctx())
      .ops.filter((op): op is Extract<FileOp, { kind: "add-dep" }> => op.kind === "add-dep");
    expect(deps).toContainEqual(
      expect.objectContaining({ name: "@zitadel/sdk-solid-start", version: "alpha" }),
    );
    expect(deps).toContainEqual(
      expect.objectContaining({ name: "@zitadel/sdk-solid", version: "alpha" }),
    );
  });
});

describe("SolidStartPatcher.artifacts", () => {
  it("lists the routes + middleware as managed, the SDK as a dependency, vite.config as a manual edit", () => {
    const artifacts = new SolidStartPatcher().artifacts({
      framework: { id: "solid-start", appDir: "src", devPort: 3000, url: "http://localhost:3000" },
      rendererId: "solid",
    });
    expect(artifacts.markedFiles).toContain("src/middleware.ts");
    expect(artifacts.markedFiles).toContain("src/routes/login.tsx");
    expect(artifacts.dependencies).toEqual(["@zitadel/sdk-solid-start", "@zitadel/sdk-solid"]);
    expect(artifacts.configEdits).toEqual(["vite.config.*"]);
  });
});

describe("SolidStartPatcher.canPatch", () => {
  it("matches solid-start only", () => {
    const patcher = new SolidStartPatcher();
    expect(patcher.canPatch("solid-start")).toBe(true);
    expect(patcher.canPatch("solid")).toBe(false);
  });
});
