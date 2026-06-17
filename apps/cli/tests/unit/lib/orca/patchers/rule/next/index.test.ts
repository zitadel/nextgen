import { describe, expect, it } from "vitest";

import type {
  FileOp,
  ScaffoldPlan,
} from "../../../../../../../src/lib/orca/patchers/rule/file-writer/types";
import { NextPatcher } from "../../../../../../../src/lib/orca/patchers/rule/next";
import type { PatchContext } from "../../../../../../../src/lib/orca/patchers/types";
import { MANAGED_MARKER } from "../../../../../../../src/lib/paths";

function ctxFor(
  appDir: "app" | "src/app",
  versionMajor = 15,
  scaffoldedFramework = false,
): PatchContext {
  return {
    framework: { id: "next", appDir, devPort: 3000, url: "http://localhost:3000", versionMajor },
    rendererId: "react",
    project: {
      id: "proj-1",
      projectSecret: "sk_proj_full",
      previewSecret: "sk_proj_preview",
      previewOrigins: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    issuer: "http://localhost:3000",
    server: "https://api.zitadel.cloud",
    cliVersion: "0.1.0-alpha.0",
    scaffoldedFramework,
  };
}

function writeContents(plan: ScaffoldPlan, path: string): string | undefined {
  const op = plan.ops.find(
    (candidate): candidate is Extract<FileOp, { kind: "write" }> =>
      candidate.kind === "write" && candidate.path === path,
  );
  return op?.contents;
}

function editContents(plan: ScaffoldPlan, path: string, source = ""): string | undefined {
  const op = plan.ops.find(
    (candidate): candidate is Extract<FileOp, { kind: "edit" }> =>
      candidate.kind === "edit" && candidate.path === path,
  );
  return op?.edit(source);
}

describe("NextPatcher.plan", () => {
  it("emits the base .zitadel files and Next routes for the app dir", () => {
    const plan = new NextPatcher().plan(ctxFor("app"));
    expect(writeContents(plan, "zitadel.json")).toContain('"project": "proj-1"');
    expect(editContents(plan, "app/page.tsx")).toBeUndefined();
    expect(writeContents(plan, "app/login/page.tsx")).toContain(MANAGED_MARKER);
    expect(writeContents(plan, "app/login/page.tsx")).toContain('href="/register"');
    expect(writeContents(plan, "app/login/page.tsx")).not.toContain('href="/profile"');
    expect(writeContents(plan, "app/login/page.tsx")).toContain('background: "#0f0f11"');
    expect(writeContents(plan, "app/login/page.tsx")).toContain('color: "#f4f4f6"');
    expect(writeContents(plan, "app/login/page.tsx")).not.toContain('alignItems: "center"');
    expect(writeContents(plan, "app/login/page.tsx")).not.toContain('padding: "48px 24px"');
    expect(writeContents(plan, "app/register/page.tsx")).toContain(MANAGED_MARKER);
    expect(writeContents(plan, "app/register/page.tsx")).toContain('href="/login"');
    expect(writeContents(plan, "app/register/page.tsx")).not.toContain('href="/profile"');
    expect(writeContents(plan, "app/register/page.tsx")).toContain('background: "#0f0f11"');
    expect(writeContents(plan, "app/register/page.tsx")).toContain('color: "#f4f4f6"');
    expect(writeContents(plan, "middleware.ts")).toContain(MANAGED_MARKER);
    expect(writeContents(plan, "middleware.ts")).toContain("export function middleware(");
    expect(plan.ops.some((op) => op.kind === "add-dep")).toBe(true);
  });

  it("replaces the starter home page for a freshly scaffolded Next app", () => {
    const plan = new NextPatcher().plan(ctxFor("app", 15, true));
    const homePage = editContents(plan, "app/page.tsx", "starter");

    expect(homePage).toContain(MANAGED_MARKER);
    expect(homePage).toContain('href="/login"');
    expect(homePage).toContain('href="/register"');
    expect(homePage).toContain('href="/profile"');
  });

  it("emits proxy.ts for Next 16 projects", () => {
    const plan = new NextPatcher().plan(ctxFor("app", 16));
    expect(writeContents(plan, "proxy.ts")).toContain(MANAGED_MARKER);
    expect(writeContents(plan, "proxy.ts")).toContain("export function proxy(");
    expect(writeContents(plan, "middleware.ts")).toBeUndefined();
  });

  it("uses the CLI prerelease tag for the SDK dependency", () => {
    const plan = new NextPatcher().plan(ctxFor("app"));
    const dep = plan.ops.find(
      (op): op is Extract<FileOp, { kind: "add-dep" }> => op.kind === "add-dep",
    );
    expect(dep).toMatchObject({ name: "@zitadel/sdk-next", version: "0.1.0-alpha.0" });
  });

  it("leaves schema and flow files for setup's resource materializer", () => {
    const plan = new NextPatcher().plan(ctxFor("app"));
    expect(writeContents(plan, ".zitadel/schemas/user.json")).toBeUndefined();
    expect(writeContents(plan, ".zitadel/flows/default.json")).toBeUndefined();
  });

  it("writes preview issuer_pattern as the raw origins, not a doubled scheme", () => {
    const base = ctxFor("app");
    const ctx = {
      ...base,
      project: { ...base.project, previewOrigins: ["https://nextgen.dev.mrida.ng"] },
    };
    const zitadelJson = JSON.parse(
      writeContents(new NextPatcher().plan(ctx), "zitadel.json") ?? "{}",
    );
    expect(zitadelJson.environments.preview.issuer_pattern).toEqual([
      "https://nextgen.dev.mrida.ng",
    ]);
  });

  it("honors the src/app directory", () => {
    const plan = new NextPatcher().plan(ctxFor("src/app"));
    expect(writeContents(plan, "src/app/login/page.tsx")).toContain(MANAGED_MARKER);
  });
});

describe("NextPatcher.artifacts", () => {
  it("lists managed files, the config file, the dir, and the env backup", () => {
    const artifacts = new NextPatcher().artifacts({
      framework: { id: "next", appDir: "app", devPort: 3000, url: "http://localhost:3000" },
      rendererId: "react",
    });
    expect(artifacts.markedFiles).toEqual([
      "app/page.tsx",
      "app/login/page.tsx",
      "app/register/page.tsx",
      "app/profile/page.tsx",
      "middleware.ts",
      "custom-elements.d.ts",
    ]);
    expect(artifacts.rootConfigFiles).toEqual(["zitadel.json"]);
    expect(artifacts.directories).toEqual([".zitadel"]);
    expect(artifacts.envBackups).toEqual([".env.local"]);
    // The react renderer's SDK package — `eject` surfaces this as
    // `npm uninstall <name>` in next_commands.
    expect(artifacts.dependencies).toEqual(["@zitadel/sdk-next"]);
  });

  it("lists proxy.ts as the managed request boundary for Next 16 projects", () => {
    const artifacts = new NextPatcher().artifacts({
      framework: {
        id: "next",
        appDir: "app",
        devPort: 3000,
        url: "http://localhost:3000",
        versionMajor: 16,
      },
      rendererId: "react",
    });
    expect(artifacts.markedFiles).toContain("proxy.ts");
    expect(artifacts.markedFiles).not.toContain("middleware.ts");
  });
});
