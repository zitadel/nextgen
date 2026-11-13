import { execaSync } from "execa";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi, beforeEach } from "vitest";

import { frameworkCli } from "@/lib/orca/scaffolders/framework-clis";
import { SvelteKitScaffolder } from "@/lib/orca/scaffolders/sveltekit";
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

describe("SvelteKitScaffolder", () => {
  it("runs `sv create` without an install, then removes the starter +page.svelte", async () => {
    mockSpawn.mockReturnValue(spawnOk());

    await new SvelteKitScaffolder(SUPPORTED_NODE).scaffold("/tmp/proj", "sveltekit");

    const [command, args, opts] = scaffoldingCalls()[0] ?? [];
    expect(command).toBe("npx");
    expect(args).toEqual([
      "-y",
      frameworkCli("sv"),
      "create",
      ".",
      "--template",
      "minimal",
      "--types",
      "ts",
      "--no-add-ons",
      "--no-install",
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
    spec: frameworkCli("sv"),
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
