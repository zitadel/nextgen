import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi, beforeEach } from "vitest";

import { AngularScaffolder } from "../../../../../src/lib/orca/scaffolders/angular";

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

describe("AngularScaffolder", () => {
  it("runs ng new then removes the starter app.ts/app.html", async () => {
    mockSpawn.mockReturnValue(spawnOk());

    await new AngularScaffolder().scaffold("/tmp/proj", "angular");

    const [command, args, opts] = mockSpawn.mock.calls[0] ?? [];
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

  it("only supports angular", () => {
    const scaffolder = new AngularScaffolder();
    expect(scaffolder.canScaffold("angular")).toBe(true);
    expect(scaffolder.canScaffold("react")).toBe(false);
  });
});
