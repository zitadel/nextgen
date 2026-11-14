import { execaSync } from "execa";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi, beforeEach } from "vitest";

import { frameworkCli, frameworkCliVersion } from "@/lib/orca/scaffolders/framework-clis";
import { VueScaffolder } from "@/lib/orca/scaffolders/vue";
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

describe("VueScaffolder", () => {
  it("runs create-vite then removes the starter App.vue/HelloWorld.vue", async () => {
    mockSpawn.mockReturnValue(spawnOk());

    await new VueScaffolder(SUPPORTED_NODE).scaffold("/tmp/proj", "vue");

    const [command, args, opts] = scaffoldingCalls()[0] ?? [];
    expect(command).toBe("npm");
    expect(args).toEqual([
      "create",
      `vite@${frameworkCliVersion("create-vite")}`,
      ".",
      "--",
      "--template",
      "vue-ts",
    ]);
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
    spec: frameworkCli("create-vite"),
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
