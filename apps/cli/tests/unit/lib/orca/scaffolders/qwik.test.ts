import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi, beforeEach } from "vitest";

import { QwikScaffolder } from "../../../../../src/lib/orca/scaffolders/qwik";

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

describe("QwikScaffolder", () => {
  it("runs create-vite then removes the starter app.tsx/app.css", async () => {
    mockSpawn.mockReturnValue(spawnOk());

    await new QwikScaffolder().scaffold("/tmp/proj", "qwik");

    const [command, args, opts] = mockSpawn.mock.calls[0] ?? [];
    expect(command).toBe("npm");
    expect(args).toEqual(["create", "vite@latest", ".", "--", "--template", "qwik-ts"]);
    expect(opts).toMatchObject({ cwd: "/tmp/proj" });
    expect(mockRm).toHaveBeenCalledWith(join("/tmp/proj", "src/app.tsx"), { force: true });
    expect(mockRm).toHaveBeenCalledWith(join("/tmp/proj", "src/app.css"), { force: true });
  });

  it("only supports qwik", () => {
    const scaffolder = new QwikScaffolder();
    expect(scaffolder.canScaffold("qwik")).toBe(true);
    expect(scaffolder.canScaffold("react")).toBe(false);
  });
});
