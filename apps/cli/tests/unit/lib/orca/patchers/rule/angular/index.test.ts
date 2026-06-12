import { describe, expect, it } from "vitest";

import type {
  FileOp,
  ScaffoldPlan,
} from "../../../../../../../src/lib/orca/patchers/rule/file-writer/types";
import { AngularPatcher } from "../../../../../../../src/lib/orca/patchers/rule/angular";
import type { PatchContext } from "../../../../../../../src/lib/orca/patchers/types";
import { MANAGED_MARKER } from "../../../../../../../src/lib/paths";

function ctx(): PatchContext {
  return {
    framework: { id: "angular", appDir: "src/app", devPort: 3000, url: "http://localhost:3000" },
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

function packageJsonEdit(): (source: string | undefined) => string {
  const op = new AngularPatcher()
    .plan(ctx())
    .ops.find(
      (candidate): candidate is Extract<FileOp, { kind: "edit" }> =>
        candidate.kind === "edit" && candidate.path === "package.json",
    );
  if (!op) {
    throw new Error("expected a package.json edit op in the Angular plan");
  }
  return op.edit;
}

describe("AngularPatcher.plan", () => {
  it("writes the managed root component, template, and proxy config", () => {
    const plan = new AngularPatcher().plan(ctx());
    expect(writeContents(plan, "src/app/app.ts")).toContain(MANAGED_MARKER);
    expect(writeContents(plan, "src/app/app.html")).toContain(MANAGED_MARKER);
    expect(writeContents(plan, "proxy.conf.cjs")).toContain(MANAGED_MARKER);
    const edit = plan.ops.find((op): op is Extract<FileOp, { kind: "edit" }> => op.kind === "edit");
    expect(edit?.path).toBe("angular.json");
  });

  it("adds a `dev` npm script so `npm run dev` works like the other frameworks", () => {
    const result = JSON.parse(packageJsonEdit()(`{ "scripts": { "start": "ng serve" } }`));
    expect(result.scripts.dev).toBe("ng serve");
    expect(result.scripts.start).toBe("ng serve");
  });

  it("preserves an existing `dev` script instead of overwriting it", () => {
    const result = JSON.parse(packageJsonEdit()(`{ "scripts": { "dev": "ng serve --hmr" } }`));
    expect(result.scripts.dev).toBe("ng serve --hmr");
  });

  it("fails fast when package.json is absent instead of fabricating one", () => {
    expect(() => packageJsonEdit()(undefined)).toThrowError(/package\.json is required/);
  });

  it("adds the SDK dependency at the CLI's prerelease tag", () => {
    const dep = new AngularPatcher()
      .plan(ctx())
      .ops.find((op): op is Extract<FileOp, { kind: "add-dep" }> => op.kind === "add-dep");
    expect(dep).toMatchObject({ name: "@zitadel/sdk-angular", version: "alpha" });
  });
});

describe("AngularPatcher.artifacts", () => {
  it("lists the component files as managed and angular.json as a manual config edit", () => {
    const artifacts = new AngularPatcher().artifacts({
      framework: { id: "angular", appDir: "src/app", devPort: 3000, url: "http://localhost:3000" },
      rendererId: "react",
    });
    expect(artifacts.markedFiles).toContain("src/app/app.ts");
    expect(artifacts.dependencies).toEqual(["@zitadel/sdk-angular"]);
    expect(artifacts.configEdits).toEqual(["angular.json"]);
  });
});
