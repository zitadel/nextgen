import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi, beforeEach } from "vitest";

import { QwikCityScaffolder } from "../../../../../src/lib/orca/scaffolders/qwik-city";

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

describe("QwikCityScaffolder", () => {
  it("runs `create-qwik` then removes the starter index.tsx", async () => {
    mockSpawn.mockReturnValue(spawnOk());

    await new QwikCityScaffolder().scaffold("/tmp/proj", "qwik-city");

    const [command, args, opts] = mockSpawn.mock.calls[0] ?? [];
    expect(command).toBe("npx");
    expect(args).toEqual(["-y", "create-qwik@latest", "empty", "."]);
    expect(opts).toMatchObject({ cwd: "/tmp/proj" });
    expect(mockRm).toHaveBeenCalledWith(join("/tmp/proj", "src/routes/index.tsx"), {
      force: true,
    });
  });

  it("only supports qwik-city", () => {
    const scaffolder = new QwikCityScaffolder();
    expect(scaffolder.canScaffold("qwik-city")).toBe(true);
    expect(scaffolder.canScaffold("qwik")).toBe(false);
  });
});
