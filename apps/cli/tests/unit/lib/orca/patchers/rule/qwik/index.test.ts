import { describe, expect, it } from "vitest";

import type {
  FileOp,
  ScaffoldPlan,
} from "../../../../../../../src/lib/orca/patchers/rule/file-writer/types";
import { QwikPatcher } from "../../../../../../../src/lib/orca/patchers/rule/qwik";
import type { PatchContext } from "../../../../../../../src/lib/orca/patchers/types";
import { MANAGED_MARKER } from "../../../../../../../src/lib/paths";

function ctx(): PatchContext {
  return {
    framework: { id: "qwik", appDir: "src", devPort: 3000, url: "http://localhost:3000" },
    rendererId: "qwik",
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

describe("QwikPatcher.plan", () => {
  it("writes the managed app.tsx and merges the Vite config", () => {
    const plan = new QwikPatcher().plan(ctx());
    expect(writeContents(plan, "src/app.tsx")).toContain(MANAGED_MARKER);
    const edit = plan.ops.find(
      (op): op is Extract<FileOp, { kind: "edit" }> =>
        op.kind === "edit" && String(op.path).includes("vite.config"),
    );
    expect(edit?.path).toContain("vite.config.ts");
  });

  it("wires the business copy overlay for business-use-case projects", () => {
    // Minimal scaffolds keep the widget's neutral built-in copy.
    expect(writeContents(new QwikPatcher().plan(ctx()), "src/app.tsx")).not.toContain(
      "businessLocales",
    );
    const business = writeContents(
      new QwikPatcher().plan({ ...ctx(), useCase: "business" }),
      "src/app.tsx",
    );
    // The overlay ships with the SDK, and the wrapper component assigns the
    // locales prop as a DOM property internally.
    expect(business).toContain("businessLocales, configureZitadel");
    expect(business).toContain("locales={businessLocales}");
    // Consumer scaffolds keep the neutral built-ins, like minimal ones.
    const consumer = new QwikPatcher().plan({ ...ctx(), useCase: "consumer" });
    expect(writeContents(consumer, "src/app.tsx")).not.toContain("businessLocales");
  });

  it("adds the SDK dependency at the CLI's prerelease tag", () => {
    const dep = new QwikPatcher()
      .plan(ctx())
      .ops.find((op): op is Extract<FileOp, { kind: "add-dep" }> => op.kind === "add-dep");
    expect(dep).toMatchObject({ name: "@zitadel/sdk-qwik", version: "alpha" });
  });

  it("exposes the project id through a VITE_-prefixed env var", () => {
    const env = new QwikPatcher()
      .plan(ctx())
      .ops.filter((op): op is Extract<FileOp, { kind: "merge-env" }> => op.kind === "merge-env");
    expect(env.some((op) => "VITE_ZITADEL_PROJECT_ID" in op.entries)).toBe(true);
  });
});

describe("QwikPatcher.artifacts", () => {
  it("lists app.tsx as managed and the Vite config as a manual config edit", () => {
    const artifacts = new QwikPatcher().artifacts({
      framework: { id: "qwik", appDir: "src", devPort: 3000, url: "http://localhost:3000" },
      rendererId: "qwik",
    });
    expect(artifacts.markedFiles).toContain("src/app.tsx");
    expect(artifacts.dependencies).toEqual(["@zitadel/sdk-qwik"]);
    expect(artifacts.configEdits).toEqual(["vite.config.*"]);
  });
});
