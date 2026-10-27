import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi, beforeEach } from "vitest";

import { VueScaffolder } from "../../../../../src/lib/orca/scaffolders/vue";
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

describe("VueScaffolder", () => {
  it("runs create-vite then removes the starter App.vue/HelloWorld.vue", async () => {
    mockSpawn.mockReturnValue(spawnOk());

    await new VueScaffolder(SUPPORTED_NODE).scaffold("/tmp/proj", "vue");

    const [command, args, opts] = scaffoldingCalls()[0] ?? [];
    expect(command).toBe("npm");
    expect(args).toEqual(["create", "vite@9.3.1", ".", "--", "--template", "vue-ts"]);
    expect(opts).toMatchObject({ cwd: "/tmp/proj" });
    expect(mockRm).toHaveBeenCalledWith(join("/tmp/proj", "src/App.vue"), { force: true });
    expect(mockRm).toHaveBeenCalledWith(join("/tmp/proj", "src/components/HelloWorld.vue"), {
      force: true,
    });
  });

  describeNodeEngines({
    make: (node, platform) => new VueScaffolder(node, platform),
    framework: "vue",
    label: "create-vite",
    spec: "create-vite@9.3.1",
    fallback: "^20.19.0 || >=22.12.0",
    enforcement: "warn",
    supported: ["24.15.0", "20.19.0", "22.12.0"],
    warned: ["21.0.0", "20.18.0"],
    refused: [],
  });

  it("only supports vue", () => {
    const scaffolder = new VueScaffolder();
    expect(scaffolder.canScaffold("vue")).toBe(true);
    expect(scaffolder.canScaffold("react")).toBe(false);
  });
});
