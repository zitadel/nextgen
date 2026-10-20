import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Orca } from "../../../../src/lib/orca";
import type { Detector } from "../../../../src/lib/orca";
import type { Scaffolder } from "../../../../src/lib/orca/scaffolders/types";

// Real file system calls, with `rename` replaceable per test: the stash moves
// each entry aside by renaming it.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

const dirs: string[] = [];
afterEach(async () => {
  vi.mocked(rename).mockClear();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
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
  const orca = new Orca([fakeDetector], [fakeScaffolder], []);

  it("puts back what it moved when moving an entry aside fails", async () => {
    const parent = await mkdtemp(join(tmpdir(), "zitadel-orca-stash-"));
    dirs.push(parent);
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
