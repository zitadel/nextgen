import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi, beforeEach } from "vitest";

import { SolidStartScaffolder } from "../../../../../src/lib/orca/scaffolders/solid-start";

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

describe("SolidStartScaffolder", () => {
  it("runs `create-solid` then removes the starter src/routes/index.tsx", async () => {
    mockSpawn.mockReturnValue(spawnOk());

    await new SolidStartScaffolder().scaffold("/tmp/proj", "solid-start");

    const [command, args, opts] = mockSpawn.mock.calls[0] ?? [];
    expect(command).toBe("npx");
    expect(args).toEqual([
      "-y",
      "create-solid@latest",
      ".",
      "basic",
      "--solidstart",
      "--ts",
      "--v2",
    ]);
    expect(opts).toMatchObject({ cwd: "/tmp/proj" });
    expect(mockRm).toHaveBeenCalledWith(join("/tmp/proj", "src/routes/index.tsx"), {
      force: true,
    });
  });

  it("only supports solid-start", () => {
    const scaffolder = new SolidStartScaffolder();
    expect(scaffolder.canScaffold("solid-start")).toBe(true);
    expect(scaffolder.canScaffold("solid")).toBe(false);
  });
});
