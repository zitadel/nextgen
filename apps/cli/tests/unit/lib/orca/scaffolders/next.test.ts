import { spawnSync } from "node:child_process";

import { describe, expect, it, vi, beforeEach } from "vitest";

import { NextScaffolder } from "../../../../../src/lib/orca/scaffolders/next";
import {
  SUPPORTED_NODE,
  describeNodeEngines,
  scaffoldingCalls,
} from "../../../../helpers/node-engines";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));
const mockSpawn = vi.mocked(spawnSync);

function spawnResult(status: number, stderr = "", stdout = ""): ReturnType<typeof spawnSync> {
  return { status, stderr, stdout, pid: 1, output: [], signal: null } as ReturnType<
    typeof spawnSync
  >;
}

beforeEach(() => {
  mockSpawn.mockReset();
});

describe("NextScaffolder", () => {
  it("invokes create-next-app with the expected command and args", async () => {
    mockSpawn.mockReturnValue(spawnResult(0));

    await new NextScaffolder(SUPPORTED_NODE).scaffold("/tmp/proj", "next");

    expect(scaffoldingCalls()).toHaveLength(1);
    const [command, args, opts] = scaffoldingCalls()[0] ?? [];
    expect(command).toBe("npx");
    expect(args).toEqual([
      "--yes",
      "create-next-app@16.4.2",
      ".",
      "--ts",
      "--app",
      "--use-npm",
      "--disable-git",
      "--yes",
      "--skip-install",
    ]);
    expect(opts).toMatchObject({ cwd: "/tmp/proj" });
  });

  it("throws E_VALIDATION when the command exits non-zero", async () => {
    mockSpawn.mockReturnValue(spawnResult(1, "boom", "hello"));
    await expect(
      new NextScaffolder(SUPPORTED_NODE).scaffold("/tmp/proj", "next"),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
      hint: expect.stringContaining("boom"),
      details: expect.objectContaining({ stderr: "boom", stdout: "hello" }),
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

    await expect(
      new NextScaffolder(SUPPORTED_NODE).scaffold("/tmp/proj", "next"),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: expect.stringContaining("Command not found"),
      hint: expect.stringContaining("PATH"),
    });
  });

  describeNodeEngines({
    make: (node, platform) => new NextScaffolder(node, platform),
    framework: "next",
    label: "create-next-app",
    spec: "create-next-app@16.4.2",
    fallback: ">=20.9.0",
    enforcement: "warn",
    supported: ["24.15.0", "20.9.0"],
    warned: ["18.0.0"],
    refused: [],
  });

  it("only supports next", () => {
    const scaffolder = new NextScaffolder();
    expect(scaffolder.canScaffold("next")).toBe(true);
    expect(scaffolder.canScaffold("nuxt")).toBe(false);
  });
});
