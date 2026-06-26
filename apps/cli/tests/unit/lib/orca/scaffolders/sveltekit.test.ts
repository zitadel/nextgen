import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi, beforeEach } from "vitest";

import { SvelteKitScaffolder } from "../../../../../src/lib/orca/scaffolders/sveltekit";

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

describe("SvelteKitScaffolder", () => {
  it("runs `sv create` then removes the starter +page.svelte", async () => {
    mockSpawn.mockReturnValue(spawnOk());

    await new SvelteKitScaffolder().scaffold("/tmp/proj", "sveltekit");

    const [command, args, opts] = mockSpawn.mock.calls[0] ?? [];
    expect(command).toBe("npx");
    expect(args).toEqual([
      "-y",
      "sv@latest",
      "create",
      ".",
      "--template",
      "minimal",
      "--types",
      "ts",
      "--no-add-ons",
      "--install",
      "npm",
    ]);
    expect(opts).toMatchObject({ cwd: "/tmp/proj" });
    expect(mockRm).toHaveBeenCalledWith(join("/tmp/proj", "src/routes/+page.svelte"), {
      force: true,
    });
    expect(mockRm).toHaveBeenCalledWith(join("/tmp/proj", "src/routes/+layout.svelte"), {
      force: true,
    });
  });

  it("only supports sveltekit", () => {
    const scaffolder = new SvelteKitScaffolder();
    expect(scaffolder.canScaffold("sveltekit")).toBe(true);
    expect(scaffolder.canScaffold("svelte")).toBe(false);
  });
});
