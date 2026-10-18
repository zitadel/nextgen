import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi, beforeEach } from "vitest";

import { SvelteKitScaffolder } from "../../../../../src/lib/orca/scaffolders/sveltekit";
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

describe("SvelteKitScaffolder", () => {
  it("runs `sv create` then removes the starter +page.svelte", async () => {
    mockSpawn.mockReturnValue(spawnOk());

    await new SvelteKitScaffolder(SUPPORTED_NODE).scaffold("/tmp/proj", "sveltekit");

    const [command, args, opts] = scaffoldingCalls()[0] ?? [];
    expect(command).toBe("npx");
    expect(args).toEqual([
      "-y",
      "sv@latest",
      "create",
      ".",
      "--template",
      "minimal",
      "--types",
      "ts",
      "--no-add-ons",
      "--install",
      "npm",
    ]);
    expect(opts).toMatchObject({ cwd: "/tmp/proj" });
    expect(mockRm).toHaveBeenCalledWith(join("/tmp/proj", "src/routes/+page.svelte"), {
      force: true,
    });
    expect(mockRm).toHaveBeenCalledWith(join("/tmp/proj", "src/routes/+layout.svelte"), {
      force: true,
    });
  });

  describeNodeEngines({
    make: (node, platform) => new SvelteKitScaffolder(node, platform),
    framework: "sveltekit",
    label: "sv",
    spec: "sv@latest",
    fallback: "^20.19.0 || >=22.12.0",
    enforcement: "warn",
    supported: ["24.15.0", "20.19.0", "22.12.0"],
    warned: ["21.0.0", "20.18.0"],
    refused: [],
  });

  it("only supports sveltekit", () => {
    const scaffolder = new SvelteKitScaffolder();
    expect(scaffolder.canScaffold("sveltekit")).toBe(true);
    expect(scaffolder.canScaffold("svelte")).toBe(false);
  });
});
