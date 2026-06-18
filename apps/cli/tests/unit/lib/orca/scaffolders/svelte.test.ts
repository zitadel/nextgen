import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi, beforeEach } from "vitest";

import { SvelteScaffolder } from "../../../../../src/lib/orca/scaffolders/svelte";

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

describe("SvelteScaffolder", () => {
  it("runs create-vite then removes the starter App.svelte/lib/Counter.svelte", async () => {
    mockSpawn.mockReturnValue(spawnOk());

    await new SvelteScaffolder().scaffold("/tmp/proj", "svelte");

    const [command, args, opts] = mockSpawn.mock.calls[0] ?? [];
    expect(command).toBe("npm");
    expect(args).toEqual(["create", "vite@latest", ".", "--", "--template", "svelte-ts"]);
    expect(opts).toMatchObject({ cwd: "/tmp/proj" });
    expect(mockRm).toHaveBeenCalledWith(join("/tmp/proj", "src/App.svelte"), { force: true });
    expect(mockRm).toHaveBeenCalledWith(join("/tmp/proj", "src/lib/Counter.svelte"), {
      force: true,
    });
  });

  it("only supports svelte", () => {
    const scaffolder = new SvelteScaffolder();
    expect(scaffolder.canScaffold("svelte")).toBe(true);
    expect(scaffolder.canScaffold("react")).toBe(false);
  });
});
