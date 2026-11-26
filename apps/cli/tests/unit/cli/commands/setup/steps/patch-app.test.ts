import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { PatchApp } from "@/cli/commands/setup/steps/patch-app";
import { createOrca } from "@/lib/orca";
import { LocalRuntime } from "@/lib/server";
import { type Step, Ui, warnings } from "@/lib/ui";
import { it } from "@tests/fixtures";
import { aPatchContext } from "@tests/helpers/patch-context";
import { aPromptDeps } from "@tests/helpers/setup";
import { rejectionOf } from "@tests/helpers/thrown-value";

/** A UI whose steps cannot list a detail. */
class DetailFailingUi extends Ui {
  override begin(label: string): Step {
    const step = super.begin(label);
    return {
      detail: () => {
        throw new Error("cannot list a detail");
      },
      done: (text) => {
        step.done(text);
      },
      fail: (text) => {
        step.fail(text);
      },
    };
  }
}

describe("PatchApp undo", () => {
  it("restores the credential files and warns when a marker cannot be removed", async ({ dir }) => {
    await mkdir(join(dir, "zitadel.json"));
    await writeFile(join(dir, "zitadel.json", "kept"), "x");
    await writeFile(join(dir, ".env.local"), "ZITADEL_PROJECT_ID=abandoned\n");

    await new PatchApp({ ...aPromptDeps(dir), force: false }).undo({
      patched: {
        dryRun: false,
        files: [],
        filesWritten: [],
        filesSkipped: [],
        depsAdded: [],
      },
      envFilesBefore: new Map([[".env.local", Buffer.from("EXISTING=1\n")]]),
      patching: undefined,
    });

    expect(await readFile(join(dir, ".env.local"), "utf8")).toBe("EXISTING=1\n");
    expect(warnings.take().join("\n")).toContain("Could not remove zitadel.json");
  });
});

describe("PatchApp run", () => {
  it("keeps what the patch wrote when listing it fails", async ({ dir }) => {
    await writeFile(join(dir, "package.json"), "{}\n");

    await rejectionOf(() => {
      return new PatchApp({
        cwd: dir,
        dryRun: false,
        force: false,
        ui: new DetailFailingUi({ interactive: false, force: false }),
      }).run({
        patcher: createOrca(LocalRuntime.DIR).patcherFor("next"),
        patchContext: () => {
          return aPatchContext("next");
        },
        framework: aPatchContext("next").framework,
        project: { ...aPatchContext("next").project, name: "demo" },
      });
    });

    await expect(access(join(dir, "zitadel.json"))).resolves.toBeUndefined();
  });
});
