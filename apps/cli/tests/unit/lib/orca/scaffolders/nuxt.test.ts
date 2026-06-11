import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi, beforeEach } from "vitest";

import { NuxtScaffolder } from "../../../../../src/lib/orca/scaffolders/nuxt";

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

    await new NuxtScaffolder().scaffold("/tmp/proj", "nuxt");

    const [command, args, opts] = mockSpawn.mock.calls[0] ?? [];
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
    expect(mockRm).toHaveBeenCalledWith(join("/tmp/proj", "app.vue"), { force: true });
  });

  it("only supports nuxt", () => {
    const scaffolder = new NuxtScaffolder();
    expect(scaffolder.canScaffold("nuxt")).toBe(true);
    expect(scaffolder.canScaffold("next")).toBe(false);
  });
});
