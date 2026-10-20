import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi, beforeEach } from "vitest";

import { QwikRouterScaffolder } from "../../../../../src/lib/orca/scaffolders/qwik-router";
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

describe("QwikRouterScaffolder", () => {
  it("runs `create-qwik` then removes the starter index.tsx", async () => {
    mockSpawn.mockReturnValue(spawnOk());

    await new QwikRouterScaffolder(SUPPORTED_NODE).scaffold("/tmp/proj", "qwik-router");

    const [command, args, opts] = scaffoldingCalls()[0] ?? [];
    expect(command).toBe("npx");
    expect(args).toEqual(["-y", "create-qwik@2.0.0-rc.3", "empty", ".", "--installDeps=false"]);
    expect(opts).toMatchObject({ cwd: "/tmp/proj" });
    expect(mockRm).toHaveBeenCalledWith(join("/tmp/proj", "src/routes/index.tsx"), {
      force: true,
    });
  });

  describeNodeEngines({
    make: (node, platform) => new QwikRouterScaffolder(node, platform),
    framework: "qwik-router",
    label: "create-qwik",
    spec: "create-qwik@2.0.0-rc.3",
    fallback: "^18.17.0 || ^20.3.0 || >=21.0.0",
    enforcement: "warn",
    supported: ["24.15.0", "18.17.0", "20.3.0", "21.0.0"],
    warned: ["19.0.0", "20.2.0"],
    refused: [],
  });

  it("only supports qwik-router", () => {
    const scaffolder = new QwikRouterScaffolder();
    expect(scaffolder.canScaffold("qwik-router")).toBe(true);
    expect(scaffolder.canScaffold("qwik")).toBe(false);
  });
});
