import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi, beforeEach } from "vitest";

import { SvelteScaffolder } from "../../../../../src/lib/orca/scaffolders/svelte";
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

describe("SvelteScaffolder", () => {
  it("runs create-vite then removes the starter App.svelte/lib/Counter.svelte", async () => {
    mockSpawn.mockReturnValue(spawnOk());

    await new SvelteScaffolder(SUPPORTED_NODE).scaffold("/tmp/proj", "svelte");

    const [command, args, opts] = scaffoldingCalls()[0] ?? [];
    expect(command).toBe("npm");
    expect(args).toEqual(["create", "vite@latest", ".", "--", "--template", "svelte-ts"]);
    expect(opts).toMatchObject({ cwd: "/tmp/proj" });
    expect(mockRm).toHaveBeenCalledWith(join("/tmp/proj", "src/App.svelte"), { force: true });
    expect(mockRm).toHaveBeenCalledWith(join("/tmp/proj", "src/lib/Counter.svelte"), {
      force: true,
    });
  });

  describeNodeEngines({
    make: (node, platform) => new SvelteScaffolder(node, platform),
    framework: "svelte",
    label: "create-vite",
    spec: "create-vite@latest",
    fallback: "^20.19.0 || >=22.12.0",
    enforcement: "warn",
    supported: ["24.15.0", "20.19.0", "22.12.0"],
    warned: ["21.0.0", "20.18.0"],
    refused: [],
  });

  it("only supports svelte", () => {
    const scaffolder = new SvelteScaffolder();
    expect(scaffolder.canScaffold("svelte")).toBe(true);
    expect(scaffolder.canScaffold("react")).toBe(false);
  });
});
