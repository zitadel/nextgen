import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  ANGULAR_CLI_NODE_FALLBACK,
  AngularScaffolder,
} from "../../../../../src/lib/orca/scaffolders/angular";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));
vi.mock("node:fs/promises", () => ({ rm: vi.fn() }));
const mockSpawn = vi.mocked(spawnSync);
const mockRm = vi.mocked(rm);

const SUPPORTED_NODE = "24.15.0";

function spawnResult(status: number, stdout = ""): ReturnType<typeof spawnSync> {
  return { status, stderr: "", stdout, pid: 1, output: [], signal: null } as ReturnType<
    typeof spawnSync
  >;
}

/** npm reports this `engines.node` for the Angular CLI, and every later command succeeds. */
function angularPublishes(range: string): void {
  mockSpawn.mockImplementation((command) =>
    command === "npm" ? spawnResult(0, `${range}\n`) : spawnResult(0),
  );
}

function ngNewCalls(): ReadonlyArray<unknown[]> {
  return mockSpawn.mock.calls.filter(([command]) => command === "npx");
}

beforeEach(() => {
  mockSpawn.mockReset();
  mockRm.mockReset();
  mockRm.mockResolvedValue(undefined);
});

describe("AngularScaffolder", () => {
  it("runs ng new then removes the starter app.ts/app.html", async () => {
    angularPublishes(ANGULAR_CLI_NODE_FALLBACK);

    await new AngularScaffolder(SUPPORTED_NODE).scaffold("/tmp/proj", "angular");

    const [command, args, opts] = ngNewCalls()[0] ?? [];
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

  it("asks npm for the engine range of the Angular CLI it runs", async () => {
    angularPublishes(ANGULAR_CLI_NODE_FALLBACK);

    await new AngularScaffolder(SUPPORTED_NODE).scaffold("/tmp/proj", "angular");

    expect(mockSpawn.mock.calls[0]?.slice(0, 2)).toEqual([
      "npm",
      ["view", "@angular/cli@latest", "engines.node"],
    ]);
  });

  it("refuses a Node the Angular CLI rejects before running it", async () => {
    angularPublishes(ANGULAR_CLI_NODE_FALLBACK);

    await expect(
      new AngularScaffolder("24.12.0").scaffold("/tmp/proj", "angular"),
    ).rejects.toMatchObject({ code: "E_VALIDATION" });
    expect(ngNewCalls()).toEqual([]);
  });

  it("names the Node versions the Angular CLI needs and the one running", async () => {
    angularPublishes(ANGULAR_CLI_NODE_FALLBACK);

    await expect(new AngularScaffolder("24.12.0").scaffold("/tmp/proj", "angular")).rejects.toThrow(
      "The Angular CLI needs Node ^22.22.3 || ^24.15.0 || >=26.0.0; this is Node v24.12.0",
    );
  });

  it("applies the range npm publishes over the built-in one", async () => {
    angularPublishes(">=28.0.0");

    await expect(
      new AngularScaffolder(SUPPORTED_NODE).scaffold("/tmp/proj", "angular"),
    ).rejects.toThrow("needs Node >=28.0.0");
  });

  it.each([
    ["npm fails", spawnResult(1)],
    ["npm answers with no range", spawnResult(0, "\n")],
  ])("falls back to the built-in range when %s", async (_case, npmResult) => {
    mockSpawn.mockImplementation((command) => (command === "npm" ? npmResult : spawnResult(0)));

    await expect(new AngularScaffolder("24.12.0").scaffold("/tmp/proj", "angular")).rejects.toThrow(
      `needs Node ${ANGULAR_CLI_NODE_FALLBACK}`,
    );
  });

  it("only supports angular", () => {
    const scaffolder = new AngularScaffolder();
    expect(scaffolder.canScaffold("angular")).toBe(true);
    expect(scaffolder.canScaffold("react")).toBe(false);
  });
});
