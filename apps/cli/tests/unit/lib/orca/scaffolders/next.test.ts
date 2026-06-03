import { spawnSync } from "node:child_process";

import { describe, expect, it, vi, beforeEach } from "vitest";

import { NextScaffolder } from "../../../../../src/lib/orca/scaffolders/next";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));
const mockSpawn = vi.mocked(spawnSync);

function spawnResult(status: number, stderr = ""): ReturnType<typeof spawnSync> {
  return { status, stderr, stdout: "", pid: 1, output: [], signal: null } as ReturnType<
    typeof spawnSync
  >;
}

beforeEach(() => {
  mockSpawn.mockReset();
});

describe("NextScaffolder", () => {
  it("invokes create-next-app with the expected command and args", async () => {
    mockSpawn.mockReturnValue(spawnResult(0));

    await new NextScaffolder().scaffold("/tmp/proj", "next");

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const [command, args, opts] = mockSpawn.mock.calls[0] ?? [];
    expect(command).toBe("npx");
    expect(args).toEqual(["create-next-app@latest", ".", "--ts", "--app", "--no-git", "--yes"]);
    expect(opts).toMatchObject({ cwd: "/tmp/proj" });
  });

  it("throws E_VALIDATION when the command exits non-zero", async () => {
    mockSpawn.mockReturnValue(spawnResult(1, "boom"));
    await expect(new NextScaffolder().scaffold("/tmp/proj", "next")).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
  });

  it("surfaces 'Command not found' when the binary is not on PATH (ENOENT)", async () => {
    const enoent = Object.assign(new Error("spawn npx ENOENT"), { code: "ENOENT" });
    mockSpawn.mockReturnValue({
      status: null,
      stderr: "",
      stdout: "",
      pid: 0,
      output: [],
      signal: null,
      error: enoent,
    } as unknown as ReturnType<typeof spawnSync>);

    await expect(new NextScaffolder().scaffold("/tmp/proj", "next")).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: expect.stringContaining("Command not found"),
      hint: expect.stringContaining("PATH"),
    });
  });

  it("only supports next", () => {
    const scaffolder = new NextScaffolder();
    expect(scaffolder.canScaffold("next")).toBe(true);
    expect(scaffolder.canScaffold("nuxt")).toBe(false);
  });
});
