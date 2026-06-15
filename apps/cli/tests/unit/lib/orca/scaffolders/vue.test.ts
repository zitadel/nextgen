import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi, beforeEach } from "vitest";

import { VueScaffolder } from "../../../../../src/lib/orca/scaffolders/vue";

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

describe("VueScaffolder", () => {
  it("runs create-vite then removes the starter App.vue/HelloWorld.vue", async () => {
    mockSpawn.mockReturnValue(spawnOk());

    await new VueScaffolder().scaffold("/tmp/proj", "vue");

    const [command, args, opts] = mockSpawn.mock.calls[0] ?? [];
    expect(command).toBe("npm");
    expect(args).toEqual(["create", "vite@latest", ".", "--", "--template", "vue-ts"]);
    expect(opts).toMatchObject({ cwd: "/tmp/proj" });
    expect(mockRm).toHaveBeenCalledWith(join("/tmp/proj", "src/App.vue"), { force: true });
    expect(mockRm).toHaveBeenCalledWith(join("/tmp/proj", "src/components/HelloWorld.vue"), {
      force: true,
    });
  });

  it("only supports vue", () => {
    const scaffolder = new VueScaffolder();
    expect(scaffolder.canScaffold("vue")).toBe(true);
    expect(scaffolder.canScaffold("react")).toBe(false);
  });
});
