import { execaSync } from "execa";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi, beforeEach } from "vitest";

import { frameworkCli } from "@/lib/orca/scaffolders/framework-clis";
import { TanStackStartScaffolder } from "@/lib/orca/scaffolders/tanstack-start";
import { SUPPORTED_NODE, describeNodeEngines, scaffoldingCalls } from "@tests/helpers/node-engines";

vi.mock("execa", () => ({ execaSync: vi.fn() }));
vi.mock("node:fs/promises", () => ({ rm: vi.fn() }));
const mockSpawn = vi.mocked(execaSync);
const mockRm = vi.mocked(rm);

function spawnOk(): ReturnType<typeof execaSync> {
  return { exitCode: 0, failed: false, stderr: "", stdout: "" } as ReturnType<typeof execaSync>;
}

beforeEach(() => {
  mockSpawn.mockReset();
  mockRm.mockReset();
  mockRm.mockResolvedValue(undefined);
});

describe("TanStackStartScaffolder", () => {
  it("runs @tanstack/cli create (full Start mode) then removes the starter routes/index.tsx", async () => {
    mockSpawn.mockReturnValue(spawnOk());

    await new TanStackStartScaffolder(SUPPORTED_NODE).scaffold("/tmp/proj", "tanstack-start");

    const [command, args, opts] = scaffoldingCalls()[0] ?? [];
    expect(command).toBe("npx");
    expect(args).toEqual([
      "-y",
      frameworkCli("@tanstack/cli"),
      "create",
      ".",
      "--framework",
      "react",
      "--deployment",
      "nitro",
      "--no-examples",
      "--no-toolchain",
      "--no-intent",
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
    label: "@tanstack/cli",
    spec: frameworkCli("@tanstack/cli"),
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
