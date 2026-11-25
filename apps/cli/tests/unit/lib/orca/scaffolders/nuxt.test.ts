import { execaSync } from "execa";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi, beforeEach } from "vitest";

import { frameworkCli } from "@/lib/orca/scaffolders/framework-clis";
import { NuxtScaffolder } from "@/lib/orca/scaffolders/nuxt";
import { SUPPORTED_NODE, describeNodeEngines, scaffoldingCalls } from "@tests/helpers/node-engines";

vi.mock("execa", () => ({ execaSync: vi.fn() }));
vi.mock("node:fs/promises", () => ({ rm: vi.fn() }));
const mockSpawn = vi.mocked(execaSync);
const mockRm = vi.mocked(rm);

function spawnOk(): ReturnType<typeof execaSync> {
  return { exitCode: 0, failed: false, stderr: "", stdout: "" } as ReturnType<typeof execaSync>;
}

beforeEach(() => {
  mockSpawn.mockReset();
  mockRm.mockReset();
  mockRm.mockResolvedValue(undefined);
});

describe("NuxtScaffolder", () => {
  it("runs nuxi init on a starter commit without an install, then removes the starter app.vue", async () => {
    mockSpawn.mockReturnValue(spawnOk());

    await new NuxtScaffolder(SUPPORTED_NODE).scaffold("/tmp/proj", "nuxt");

    const [command, args, opts] = scaffoldingCalls()[0] ?? [];
    expect(command).toBe("npx");
    expect(args).toEqual([
      "-y",
      frameworkCli("nuxi"),
      "init",
      ".",
      "--template",
      expect.stringMatching(
        /^https:\/\/codeload\.github\.com\/nuxt\/starter\/tar\.gz\/[0-9a-f]{40}$/,
      ),
      "--packageManager",
      "npm",
      "--no-gitInit",
      "--force",
      "--no-install",
    ]);
    expect(opts).toMatchObject({ cwd: "/tmp/proj" });
    // Nuxt 4 puts app.vue under app/; older Nuxt at the root — both removed.
    expect(mockRm).toHaveBeenCalledWith(join("/tmp/proj", "app/app.vue"), { force: true });
    expect(mockRm).toHaveBeenCalledWith(join("/tmp/proj", "app.vue"), { force: true });
  });

  describeNodeEngines({
    make: (node, platform) => new NuxtScaffolder(node, platform),
    framework: "nuxt",
    label: "nuxi",
    spec: frameworkCli("nuxi"),
    fallback: "^22.21.0 || ^24.11.0 || >=26.0.0",
    enforcement: "warn",
    supported: ["24.15.0", "22.21.0", "26.0.0"],
    warned: ["24.5.0", "25.2.0"],
    refused: [],
  });

  it("only supports nuxt", () => {
    const scaffolder = new NuxtScaffolder();
    expect(scaffolder.canScaffold("nuxt")).toBe(true);
    expect(scaffolder.canScaffold("next")).toBe(false);
  });
});
