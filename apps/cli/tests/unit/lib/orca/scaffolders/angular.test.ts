import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi, beforeEach } from "vitest";

import { AngularScaffolder } from "../../../../../src/lib/orca/scaffolders/angular";
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
  mockSpawn.mockReturnValue(spawnOk());
  mockRm.mockResolvedValue(undefined);
});

describe("AngularScaffolder", () => {
  it("runs ng new then removes the starter app.ts/app.html", async () => {
    await new AngularScaffolder(SUPPORTED_NODE).scaffold("/tmp/proj", "angular");

    const [command, args, opts] = scaffoldingCalls()[0] ?? [];
    expect(command).toBe("npx");
    // ng new rejects "." as a project name, so a slug from the dir is passed
    // with --directory . to populate the current directory.
    expect(args).toEqual([
      "-y",
      "@angular/cli@latest",
      "new",
      "proj",
      "--directory",
      ".",
      "--defaults",
      "--style=css",
      "--ssr=false",
      "--skip-git",
    ]);
    expect(opts).toMatchObject({ cwd: "/tmp/proj" });
    expect(mockRm).toHaveBeenCalledWith(join("/tmp/proj", "src/app/app.ts"), { force: true });
    expect(mockRm).toHaveBeenCalledWith(join("/tmp/proj", "src/app/app.html"), { force: true });
    expect(mockRm).toHaveBeenCalledWith(join("/tmp/proj", "src/app/app.css"), { force: true });
  });

  describeNodeEngines({
    make: (node, platform) => new AngularScaffolder(node, platform),
    framework: "angular",
    label: "The Angular CLI",
    spec: "@angular/cli@latest",
    fallback: "^22.22.3 || ^24.15.0 || >=26.0.0",
    enforcement: "refuse",
    supported: ["24.15.0", "22.22.3", "26.0.0"],
    warned: ["23.11.0", "25.2.0"],
    refused: ["24.12.0", "22.21.0", "27.0.0", "21.7.0"],
  });

  it("only supports angular", () => {
    const scaffolder = new AngularScaffolder();
    expect(scaffolder.canScaffold("angular")).toBe(true);
    expect(scaffolder.canScaffold("react")).toBe(false);
  });
});
