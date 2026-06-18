import { describe, expect, it } from "vitest";

import type {
  FileOp,
  ScaffoldPlan,
} from "../../../../../../../src/lib/orca/patchers/rule/file-writer/types";
import { NuxtPatcher } from "../../../../../../../src/lib/orca/patchers/rule/nuxt";
import type { PatchContext } from "../../../../../../../src/lib/orca/patchers/types";
import { MANAGED_MARKER } from "../../../../../../../src/lib/paths";

function ctx(appDir = "app"): PatchContext {
  return {
    framework: { id: "nuxt", appDir, devPort: 3000, url: "http://localhost:3000" },
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

describe("NuxtPatcher.plan", () => {
  it("writes the managed app + pages under the Nuxt 4 app/ srcDir", () => {
    const plan = new NuxtPatcher().plan(ctx("app"));
    expect(writeContents(plan, "app/app.vue")).toContain(MANAGED_MARKER);
    expect(writeContents(plan, "app/pages/login.vue")).toContain(MANAGED_MARKER);
    expect(writeContents(plan, "app/pages/login.vue")).toContain("background: #0f0f11");
    expect(writeContents(plan, "app/pages/login.vue")).not.toContain("background: #f3f4f6");
    expect(writeContents(plan, "app/pages/login.vue")).not.toContain("align-items: center");
    expect(writeContents(plan, "app/plugins/auth.server.ts")).toContain(MANAGED_MARKER);
    const edit = plan.ops.find((op): op is Extract<FileOp, { kind: "edit" }> => op.kind === "edit");
    // nuxt.config stays at the project root, not under app/.
    expect(edit?.path).toContain("nuxt.config.ts");
  });

  it("writes at the root for a Nuxt 3 project (appDir '.')", () => {
    const plan = new NuxtPatcher().plan(ctx("."));
    expect(writeContents(plan, "app.vue")).toContain(MANAGED_MARKER);
    expect(writeContents(plan, "pages/login.vue")).toContain(MANAGED_MARKER);
  });

  it("adds the SDK dependency at the CLI's prerelease tag", () => {
    const dep = new NuxtPatcher()
      .plan(ctx())
      .ops.find((op): op is Extract<FileOp, { kind: "add-dep" }> => op.kind === "add-dep");
    expect(dep).toMatchObject({ name: "@zitadel/sdk-nuxt", version: "alpha" });
  });
});

describe("NuxtPatcher.artifacts", () => {
  it("lists the srcDir pages as managed and the Nuxt config as a manual config edit", () => {
    const artifacts = new NuxtPatcher().artifacts({
      framework: { id: "nuxt", appDir: "app", devPort: 3000, url: "http://localhost:3000" },
      rendererId: "react",
    });
    expect(artifacts.markedFiles).toContain("app/pages/login.vue");
    expect(artifacts.dependencies).toEqual(["@zitadel/sdk-nuxt"]);
    expect(artifacts.configEdits).toEqual(["nuxt.config.*"]);
  });
});
