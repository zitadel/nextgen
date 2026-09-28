import { describe, expect, it } from "vitest";

import type {
  FileOp,
  ScaffoldPlan,
} from "../../../../../../../src/lib/orca/patchers/rule/file-writer/types";
import { VuePatcher } from "../../../../../../../src/lib/orca/patchers/rule/vue";
import type { PatchContext } from "../../../../../../../src/lib/orca/patchers/types";
import { MANAGED_MARKER } from "../../../../../../../src/lib/paths";

function ctx(): PatchContext {
  return {
    framework: { id: "vue", appDir: "src", devPort: 3000, url: "http://localhost:3000" },
    rendererId: "react",
    project: {
      id: "proj-1",
      project_secret: "sk_full",
      preview_secret: "sk_preview",
      preview_origins: [],
      created_at: "2026-01-01T00:00:00.000Z",
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

describe("VuePatcher.plan", () => {
  it("writes the managed App.vue and merges the Vite config", () => {
    const plan = new VuePatcher().plan(ctx());
    expect(writeContents(plan, "src/App.vue")).toContain(MANAGED_MARKER);
    const edit = plan.ops.find(
      (op): op is Extract<FileOp, { kind: "edit" }> =>
        op.kind === "edit" && String(op.path).includes("vite.config"),
    );
    expect(edit?.path).toContain("vite.config.ts");
  });

  it("wires the business copy overlay for business-use-case projects", () => {
    // Minimal scaffolds keep the widget's neutral built-in copy.
    expect(writeContents(new VuePatcher().plan(ctx()), "src/App.vue")).not.toContain(
      "businessLocales",
    );
    const business = writeContents(
      new VuePatcher().plan({ ...ctx(), useCase: "business" }),
      "src/App.vue",
    );
    // The overlay ships with the SDK, and the wrapper component assigns the
    // locales prop as a DOM property internally.
    expect(business).toContain("businessLocales, configureZitadel");
    expect(business).toContain(':locales="businessLocales"');
    // Consumer scaffolds keep the neutral built-ins, like minimal ones.
    const consumer = new VuePatcher().plan({ ...ctx(), useCase: "consumer" });
    expect(writeContents(consumer, "src/App.vue")).not.toContain("businessLocales");
  });

  it("adds the SDK dependency at the CLI's prerelease tag", () => {
    const dep = new VuePatcher()
      .plan(ctx())
      .ops.find((op): op is Extract<FileOp, { kind: "add-dep" }> => op.kind === "add-dep");
    expect(dep).toMatchObject({ name: "@zitadel/sdk-vue", version: "alpha" });
  });
});

describe("VuePatcher.artifacts", () => {
  it("lists App.vue as managed and the Vite config as a manual config edit", () => {
    const artifacts = new VuePatcher().artifacts({
      framework: { id: "vue", appDir: "src", devPort: 3000, url: "http://localhost:3000" },
      rendererId: "react",
    });
    expect(artifacts.markedFiles).toContain("src/App.vue");
    expect(artifacts.dependencies).toEqual(["@zitadel/sdk-vue"]);
    expect(artifacts.configEdits).toEqual(["vite.config.*"]);
  });
});
