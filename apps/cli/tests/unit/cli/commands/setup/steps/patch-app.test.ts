import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { PatchApp } from "@/cli/commands/setup/steps/patch-app";
import { takeReportedWarnings } from "@/lib/warnings";
import { it } from "@tests/helpers/fixtures";
import { aPromptDeps } from "@tests/helpers/setup";

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
    expect(takeReportedWarnings().join("\n")).toContain("Could not remove zitadel.json");
  });
});
