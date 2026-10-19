import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi, beforeEach } from "vitest";

import { TanStackStartScaffolder } from "../../../../../src/lib/orca/scaffolders/tanstack-start";
import {
  SUPPORTED_NODE,
  describeNodeEngines,
  scaffoldingCalls,
} from "../../../../helpers/node-engines";

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

    await new TanStackStartScaffolder(SUPPORTED_NODE).scaffold("/tmp/proj", "tanstack-start");

    const [command, args, opts] = scaffoldingCalls()[0] ?? [];
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

  describeNodeEngines({
    make: (node, platform) => new TanStackStartScaffolder(node, platform),
    framework: "tanstack-start",
    label: "create-start-app",
    spec: "create-start-app@latest",
    fallback: "^20.19.0 || >=22.12.0",
    enforcement: "warn",
    supported: ["24.15.0", "20.19.0", "22.12.0"],
    warned: ["21.0.0", "20.18.0"],
    refused: [],
  });

  it("only supports tanstack-start", () => {
    const scaffolder = new TanStackStartScaffolder();
    expect(scaffolder.canScaffold("tanstack-start")).toBe(true);
    expect(scaffolder.canScaffold("react")).toBe(false);
  });
});
