import { execaSync } from "execa";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi, beforeEach } from "vitest";

import { ReactScaffolder } from "@/lib/orca/scaffolders/react";
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

describe("ReactScaffolder", () => {
  it("runs create-vite then removes the starter App.tsx/App.css", async () => {
    mockSpawn.mockReturnValue(spawnOk());

    await new ReactScaffolder(SUPPORTED_NODE).scaffold("/tmp/proj", "react");

    const [command, args, opts] = scaffoldingCalls()[0] ?? [];
    expect(command).toBe("npm");
    expect(args).toEqual(["create", "vite@9.3.1", ".", "--", "--template", "react-ts"]);
    expect(opts).toMatchObject({ cwd: "/tmp/proj" });
    expect(mockRm).toHaveBeenCalledWith(join("/tmp/proj", "src/App.tsx"), { force: true });
    expect(mockRm).toHaveBeenCalledWith(join("/tmp/proj", "src/App.css"), { force: true });
  });

  describeNodeEngines({
    make: (node, platform) => new ReactScaffolder(node, platform),
    framework: "react",
    label: "create-vite",
    spec: "create-vite@9.3.1",
    fallback: "^20.19.0 || >=22.12.0",
    enforcement: "warn",
    supported: ["24.15.0", "20.19.0", "22.12.0"],
    warned: ["21.0.0", "20.18.0"],
    refused: [],
  });

  it("only supports react", () => {
    const scaffolder = new ReactScaffolder();
    expect(scaffolder.canScaffold("react")).toBe(true);
    expect(scaffolder.canScaffold("vue")).toBe(false);
  });
});
