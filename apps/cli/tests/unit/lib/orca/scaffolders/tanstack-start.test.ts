import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi, beforeEach } from "vitest";

import { TanStackStartScaffolder } from "../../../../../src/lib/orca/scaffolders/tanstack-start";

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

describe("TanStackStartScaffolder", () => {
  it("runs create-start-app (full Start mode) then removes the starter routes/index.tsx", async () => {
    mockSpawn.mockReturnValue(spawnOk());

    await new TanStackStartScaffolder().scaffold("/tmp/proj", "tanstack-start");

    const [command, args, opts] = mockSpawn.mock.calls[0] ?? [];
    expect(command).toBe("npx");
    expect(args).toEqual([
      "-y",
      "create-start-app@latest",
      ".",
      "--framework",
      "react",
      "--no-examples",
      "--no-toolchain",
      "--no-git",
      "-y",
    ]);
    expect(opts).toMatchObject({ cwd: "/tmp/proj" });
    expect(mockRm).toHaveBeenCalledWith(join("/tmp/proj", "src/routes/index.tsx"), {
      force: true,
    });
  });

  it("only supports tanstack-start", () => {
    const scaffolder = new TanStackStartScaffolder();
    expect(scaffolder.canScaffold("tanstack-start")).toBe(true);
    expect(scaffolder.canScaffold("react")).toBe(false);
  });
});
