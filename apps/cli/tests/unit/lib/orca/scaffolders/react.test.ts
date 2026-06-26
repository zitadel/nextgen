import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi, beforeEach } from "vitest";

import { ReactScaffolder } from "../../../../../src/lib/orca/scaffolders/react";

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

describe("ReactScaffolder", () => {
  it("runs create-vite then removes the starter App.tsx/App.css", async () => {
    mockSpawn.mockReturnValue(spawnOk());

    await new ReactScaffolder().scaffold("/tmp/proj", "react");

    const [command, args, opts] = mockSpawn.mock.calls[0] ?? [];
    expect(command).toBe("npm");
    expect(args).toEqual(["create", "vite@latest", ".", "--", "--template", "react-ts"]);
    expect(opts).toMatchObject({ cwd: "/tmp/proj" });
    expect(mockRm).toHaveBeenCalledWith(join("/tmp/proj", "src/App.tsx"), { force: true });
    expect(mockRm).toHaveBeenCalledWith(join("/tmp/proj", "src/App.css"), { force: true });
  });

  it("only supports react", () => {
    const scaffolder = new ReactScaffolder();
    expect(scaffolder.canScaffold("react")).toBe(true);
    expect(scaffolder.canScaffold("vue")).toBe(false);
  });
});
