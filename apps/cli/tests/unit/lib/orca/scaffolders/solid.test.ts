import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi, beforeEach } from "vitest";

import { SolidScaffolder } from "../../../../../src/lib/orca/scaffolders/solid";

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

describe("SolidScaffolder", () => {
  it("runs create-vite then removes the starter App.tsx/App.css", async () => {
    mockSpawn.mockReturnValue(spawnOk());

    await new SolidScaffolder().scaffold("/tmp/proj", "solid");

    const [command, args, opts] = mockSpawn.mock.calls[0] ?? [];
    expect(command).toBe("npm");
    expect(args).toEqual(["create", "vite@latest", ".", "--", "--template", "solid-ts"]);
    expect(opts).toMatchObject({ cwd: "/tmp/proj" });
    expect(mockRm).toHaveBeenCalledWith(join("/tmp/proj", "src/App.tsx"), { force: true });
    expect(mockRm).toHaveBeenCalledWith(join("/tmp/proj", "src/App.css"), { force: true });
  });

  it("only supports solid", () => {
    const scaffolder = new SolidScaffolder();
    expect(scaffolder.canScaffold("solid")).toBe(true);
    expect(scaffolder.canScaffold("react")).toBe(false);
  });
});
