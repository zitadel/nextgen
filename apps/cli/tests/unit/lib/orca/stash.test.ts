import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { LocalRuntime } from "@/lib/server";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, vi } from "vitest";

import { Orca } from "@/lib/orca";
import type { Detector } from "@/lib/orca";
import type { Scaffolder } from "@/lib/orca/scaffolders/types";
import { it } from "@tests/fixtures";

// Real file system calls, with `rename` replaceable per test: the stash moves
// each entry aside by renaming it.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

afterEach(() => {
  vi.mocked(rename).mockClear();
});

describe("Orca.scaffold stash", () => {
  const fakeDetector: Detector = {
    framework: "fake",
    displayName: "Fake",
    versionPackage: "fake",
    versionFloor: "1",
    async detect(cwd) {
      try {
        await readFile(join(cwd, "package.json"), "utf8");
        return { id: "fake", appDir: "app", devPort: 3000, url: "http://localhost:3000" };
      } catch {
        return null;
      }
    },
  };
  const scaffold = vi.fn(async (cwd: string) => {
    await writeFile(join(cwd, "package.json"), "{}");
  });
  const fakeScaffolder: Scaffolder = {
    displayName: "Fake",
    supportedFrameworks: ["fake"],
    canScaffold: (framework) => framework === "fake",
    scaffold,
  };
  const orca = new Orca([fakeDetector], [fakeScaffolder], [], LocalRuntime.DIR);

  it("puts back what it moved when moving an entry aside fails", async ({ dir: parent }) => {
    const cwd = join(parent, "my-zitadel-app");
    await mkdir(join(cwd, ".zitadel/local"), { recursive: true });
    await writeFile(join(cwd, ".gitignore"), ".zitadel/local/\n");
    // `.gitignore` moves first, then the runtime cannot be moved.
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(rename)
      .mockImplementationOnce(actual.rename)
      .mockRejectedValueOnce(Object.assign(new Error("resource busy"), { code: "EBUSY" }));

    await expect(orca.scaffold(cwd, "fake")).rejects.toMatchObject({ code: "EBUSY" });

    expect(scaffold).not.toHaveBeenCalled();
    await expect(readFile(join(cwd, ".gitignore"), "utf8")).resolves.toBe(".zitadel/local/\n");
    expect((await readdir(cwd)).sort()).toEqual([".gitignore", ".zitadel"]);
    // No stash directory is left beside the app.
    expect(await readdir(dirname(cwd))).toEqual(["my-zitadel-app"]);
  });
});
