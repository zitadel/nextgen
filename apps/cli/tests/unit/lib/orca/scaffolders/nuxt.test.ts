import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi, beforeEach } from "vitest";

import { NuxtScaffolder } from "../../../../../src/lib/orca/scaffolders/nuxt";
import {
  SUPPORTED_NODE,
  describeNodeEngines,
  scaffoldingCalls,
} from "../../../../helpers/node-engines";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));
vi.mock("node:fs/promises", () => ({ rm: vi.fn() }));
const mockSpawn = vi.mocked(spawnSync);
const mockRm = vi.mocked(rm);

function spawnOk(): ReturnType<typeof spawnSync> {
  return { status: 0, stderr: "", stdout: "", pid: 1, output: [], signal: null } as ReturnType<
    typeof spawnSync
  >;
}

beforeEach(() => {
  mockSpawn.mockReset();
  mockRm.mockReset();
  mockRm.mockResolvedValue(undefined);
});

describe("NuxtScaffolder", () => {
  it("runs nuxi init then removes the starter app.vue", async () => {
    mockSpawn.mockReturnValue(spawnOk());

    await new NuxtScaffolder(SUPPORTED_NODE).scaffold("/tmp/proj", "nuxt");

    const [command, args, opts] = scaffoldingCalls()[0] ?? [];
    expect(command).toBe("npx");
    expect(args).toEqual([
      "-y",
      "nuxi@latest",
      "init",
      ".",
      "--template",
      "minimal",
      "--packageManager",
      "npm",
      "--no-gitInit",
      "--force",
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
    spec: "nuxi@latest",
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
