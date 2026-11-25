import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { LocalRuntime } from "@/lib/server";
import { basename, dirname, join } from "node:path";

import { describe, expect, vi } from "vitest";

import { ZitadelError } from "@/lib/errors";
import { inspectScaffoldTarget, isDirectoryOrMissing, Orca } from "@/lib/orca";
import type { Detector } from "@/lib/orca";
import { detectors } from "@/lib/orca/detectors";
import { DEFAULT_DEV_PORT } from "@/lib/orca/detectors/port";
import { patchers } from "@/lib/orca/patchers";
import { scaffolders } from "@/lib/orca/scaffolders";
import { AbstractCLIScaffolder } from "@/lib/orca/scaffolders/cli";
import type { NodeEngines } from "@/lib/orca/scaffolders/node-engines";
import type { Scaffolder } from "@/lib/orca/scaffolders/types";
import { it } from "@tests/fixtures";

vi.mock("execa", () => ({ execaSync: vi.fn(() => ({ failed: true, stdout: "" })) }));

const orca = new Orca(detectors, scaffolders, patchers, LocalRuntime.DIR);

/**
 * Makes a directory with a name npm accepts as a package name.
 *
 * @param parent - The directory to make it in.
 * @returns The new directory, which is the only thing in `parent`.
 */
async function tmpPackageSafe(parent: string): Promise<string> {
  const dir = join(parent, "my-zitadel-app");
  await mkdir(dir);
  return dir;
}

/**
 * Makes a Next app in a directory.
 *
 * @param cwd - The directory to make the app in, made if it is not there.
 * @returns The directory.
 */
async function nextProject(cwd: string): Promise<string> {
  await mkdir(join(cwd, "app"), { recursive: true });
  await writeFile(join(cwd, "package.json"), JSON.stringify({ dependencies: { next: "^15" } }));
  return cwd;
}

describe("Orca selection", () => {
  it("selects the Next scaffolder and patcher", () => {
    expect(orca.scaffolderFor("next").canScaffold("next")).toBe(true);
    expect(orca.patcherFor("next").canPatch("next")).toBe(true);
  });

  it("selects the Nuxt scaffolder and patcher", () => {
    expect(orca.scaffolderFor("nuxt").canScaffold("nuxt")).toBe(true);
    expect(orca.patcherFor("nuxt").canPatch("nuxt")).toBe(true);
  });

  it("selects the React scaffolder and patcher", () => {
    expect(orca.scaffolderFor("react").canScaffold("react")).toBe(true);
    expect(orca.patcherFor("react").canPatch("react")).toBe(true);
  });

  it("selects the Vue scaffolder and patcher", () => {
    expect(orca.scaffolderFor("vue").canScaffold("vue")).toBe(true);
    expect(orca.patcherFor("vue").canPatch("vue")).toBe(true);
  });

  it("selects the Solid scaffolder and patcher", () => {
    expect(orca.scaffolderFor("solid").canScaffold("solid")).toBe(true);
    expect(orca.patcherFor("solid").canPatch("solid")).toBe(true);
  });

  it("selects the Svelte scaffolder and patcher", () => {
    expect(orca.scaffolderFor("svelte").canScaffold("svelte")).toBe(true);
    expect(orca.patcherFor("svelte").canPatch("svelte")).toBe(true);
  });

  it("selects the Qwik scaffolder and patcher", () => {
    expect(orca.scaffolderFor("qwik").canScaffold("qwik")).toBe(true);
    expect(orca.patcherFor("qwik").canPatch("qwik")).toBe(true);
  });

  it("selects the Angular scaffolder and patcher", () => {
    expect(orca.scaffolderFor("angular").canScaffold("angular")).toBe(true);
    expect(orca.patcherFor("angular").canPatch("angular")).toBe(true);
  });

  it("throws for an unsupported framework", () => {
    expect(() => orca.scaffolderFor("ember")).toThrowError(/No scaffolder/);
    expect(() => orca.patcherFor("ember")).toThrowError(/No patcher/);
  });

  it("derives available frameworks from the scaffolder registry", () => {
    expect(orca.availableFrameworks().map((choice) => choice.id)).toEqual([
      "next",
      "nuxt",
      "tanstack-start",
      "react",
      "vue",
      "solid-start",
      "solid",
      "sveltekit",
      "svelte",
      "qwik-router",
      "qwik",
      "angular",
    ]);
  });
});

describe("Orca detection", () => {
  it("detects a Next project and extracts facts", async ({ dir }) => {
    const cwd = await nextProject(dir);
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ scripts: { dev: "next dev -p 4321" }, dependencies: { next: "^15" } }),
    );
    expect(await orca.detect(cwd)).toEqual({
      id: "next",
      appDir: "app",
      devPort: 4321,
      url: "http://localhost:4321",
      versionMajor: 15,
    });
  });

  it("throws OrcaFrameworkMissingError when nothing matches", async ({ dir }) => {
    await expect(orca.detect(dir)).rejects.toMatchObject({
      name: "OrcaFrameworkMissingError",
      category: "not_found",
      message: "Could not detect a supported app framework",
    });
  });

  it("throws OrcaFrameworkUnsupportedError for an unsupported requested framework", async ({
    dir,
  }) => {
    await expect(orca.detect(dir, "svelte")).rejects.toMatchObject({
      name: "OrcaFrameworkUnsupportedError",
      reason: "unknown",
      details: { requested: "svelte" },
    });
  });

  // Not detected would read as a directory to scaffold into, and setup's
  // --force would then scaffold a new app over this one.
  it("refuses a requested framework other than the app's own", async ({ dir }) => {
    await expect(orca.detect(await nextProject(dir), "react")).rejects.toMatchObject({
      category: "conflict",
      message: "Setup detects Next.js here, not React (Vite)",
      reason: "mismatch",
      details: { requested: "react", detected: "next" },
    });
  });

  it("reports an app it recognises but does not support, whatever was requested", async ({
    dir,
  }) => {
    const pagesRouter = dir;
    await writeFile(
      join(pagesRouter, "package.json"),
      JSON.stringify({ dependencies: { next: "^15" } }),
    );

    await expect(orca.detect(pagesRouter, "react")).rejects.toMatchObject({
      category: "unsupported",
    });
  });

  it("tryDetect returns undefined instead of throwing", async ({ dir, other }) => {
    expect(await orca.tryDetect(dir)).toBeUndefined();
    expect(await orca.tryDetect(await nextProject(other))).toMatchObject({ id: "next" });
  });

  it("treats an empty directory as a fresh scaffold target", async ({ dir }) => {
    expect(await orca.isFreshScaffoldTarget(dir)).toBe(true);
  });

  it("treats a directory holding only what start leaves as fresh", async ({ dir }) => {
    const cwd = dir;
    await writeFile(join(cwd, ".gitignore"), ".zitadel/local/\n");
    await mkdir(join(cwd, ".zitadel/local"), { recursive: true });
    await writeFile(join(cwd, ".zitadel/local/runtime.json"), "{}");

    expect(await orca.isFreshScaffoldTarget(cwd)).toBe(true);

    // After `reset`, the runtime is gone and its parent may stay behind empty.
    await rm(join(cwd, ".zitadel/local"), { recursive: true });
    expect(await orca.isFreshScaffoldTarget(cwd)).toBe(true);
  });

  it("treats a directory that does not exist yet as empty, without creating it", async ({
    dir,
  }) => {
    const cwd = join(dir, "my-zitadel-app");

    await expect(inspectScaffoldTarget(cwd, LocalRuntime.DIR)).resolves.toEqual({
      scaffoldable: true,
      entries: [],
    });
    await expect(stat(cwd)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("treats a .gitignore with rules of its own as not fresh, and names only it", async ({
    dir,
  }) => {
    const cwd = dir;
    await writeFile(join(cwd, ".gitignore"), "node_modules\n.zitadel/local/\n");
    await mkdir(join(cwd, ".zitadel/local"), { recursive: true });

    await expect(inspectScaffoldTarget(cwd, LocalRuntime.DIR)).resolves.toEqual({
      scaffoldable: false,
      reason: "Directory is not empty (contains .gitignore).",
      entries: [".gitignore", ".zitadel"],
    });
  });

  it("rejects project state and arbitrary files as fresh scaffold targets", async ({ dir }) => {
    const withSecret = join(dir, "secret");
    await mkdir(join(withSecret, ".zitadel"), { recursive: true });
    await writeFile(join(withSecret, ".zitadel/secret"), "{}");

    const withReadme = join(dir, "readme");
    await mkdir(withReadme);
    await writeFile(join(withReadme, "README.md"), "not empty");

    const withPackageJson = await nextProject(join(dir, "package"));

    await expect(orca.isFreshScaffoldTarget(withSecret)).resolves.toBe(false);
    await expect(orca.isFreshScaffoldTarget(withReadme)).resolves.toBe(false);
    await expect(orca.isFreshScaffoldTarget(withPackageJson)).resolves.toBe(false);
  });
});

describe("Orca.scaffold", () => {
  // A fake framework so the test exercises the orchestration (guard → run →
  // re-detect) without spawning a real project generator.
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
  const fakeScaffolder: Scaffolder = {
    displayName: "Fake",
    supportedFrameworks: ["fake"],
    canScaffold: (framework) => framework === "fake",
    async scaffold(cwd) {
      await writeFile(join(cwd, "package.json"), "{}");
    },
  };
  const fakeOrca = new Orca([fakeDetector], [fakeScaffolder], [], LocalRuntime.DIR);

  it("scaffolds into an empty dir and re-detects the result", async ({ dir }) => {
    const cwd = await tmpPackageSafe(dir);
    expect(await fakeOrca.scaffold(cwd, "fake")).toMatchObject({ id: "fake" });
    await expect(readFile(join(cwd, "package.json"), "utf8")).resolves.toBe("{}");
  });

  it("without force, scaffolds beside the runtime start left and restores it", async ({ dir }) => {
    const cwd = await tmpPackageSafe(dir);
    await writeFile(join(cwd, ".gitignore"), ".zitadel/local/\n");
    await mkdir(join(cwd, ".zitadel/local"), { recursive: true });
    await writeFile(join(cwd, ".zitadel/local/runtime.json"), '{"server_url":"http://localhost"}');

    const guardedScaffolder: Scaffolder = {
      ...fakeScaffolder,
      async scaffold(scaffoldCwd) {
        await expect(stat(join(scaffoldCwd, ".zitadel"))).rejects.toMatchObject({
          code: "ENOENT",
        });
        await expect(stat(join(scaffoldCwd, ".gitignore"))).rejects.toMatchObject({
          code: "ENOENT",
        });
        await writeFile(join(scaffoldCwd, ".gitignore"), "node_modules\n");
        await writeFile(join(scaffoldCwd, "package.json"), "{}");
      },
    };
    const guardedOrca = new Orca([fakeDetector], [guardedScaffolder], [], LocalRuntime.DIR);

    await expect(guardedOrca.scaffold(cwd, "fake")).resolves.toMatchObject({ id: "fake" });
    await expect(readFile(join(cwd, "package.json"), "utf8")).resolves.toBe("{}");
    // Untouched by the scaffold, so restored verbatim.
    await expect(readFile(join(cwd, ".zitadel/local/runtime.json"), "utf8")).resolves.toContain(
      "localhost",
    );
    // The scaffold created its own .gitignore, so its content is kept — but the
    // stashed ignore rules are merged back in, so `.zitadel/local/` (which keeps
    // the restored local admin credential out of git) is not silently dropped.
    await expect(readFile(join(cwd, ".gitignore"), "utf8")).resolves.toBe(
      "node_modules\n.zitadel/local/\n",
    );
  });

  it("with force, scaffolds into a non-empty dir and restores what it did not create", async ({
    dir,
  }) => {
    const cwd = await tmpPackageSafe(dir);
    await writeFile(join(cwd, "notes.txt"), "mine");
    await mkdir(join(cwd, ".zitadel/local"), { recursive: true });

    await expect(fakeOrca.scaffold(cwd, "fake", true)).resolves.toMatchObject({ id: "fake" });
    await expect(readFile(join(cwd, "package.json"), "utf8")).resolves.toBe("{}");
    await expect(readFile(join(cwd, "notes.txt"), "utf8")).resolves.toBe("mine");
    await expect(stat(join(cwd, ".zitadel/local"))).resolves.toBeTruthy();
  });

  it("scaffolds into a folder with a long name that holds the runtime start left", async ({
    dir,
  }) => {
    const parent = dir;
    const cwd = join(parent, "a".repeat(240));
    await mkdir(join(cwd, ".zitadel/local"), { recursive: true });

    await expect(fakeOrca.scaffold(cwd, "fake")).resolves.toMatchObject({ id: "fake" });
    await expect(stat(join(cwd, ".zitadel/local"))).resolves.toBeTruthy();
  });

  it("with force, a failed scaffold rolls back and restores the originals", async ({ dir }) => {
    const cwd = await tmpPackageSafe(dir);
    await writeFile(join(cwd, "keep.txt"), "original");
    await mkdir(join(cwd, ".zitadel/local"), { recursive: true });
    await writeFile(join(cwd, ".zitadel/local/runtime.json"), '{"server_url":"http://localhost"}');

    const throwingScaffolder: Scaffolder = {
      ...fakeScaffolder,
      async scaffold(scaffoldCwd) {
        // Write a partial file (even colliding with an original name) then fail.
        await writeFile(join(scaffoldCwd, "keep.txt"), "partial garbage");
        await writeFile(join(scaffoldCwd, "half-written.txt"), "junk");
        throw new ZitadelError("E_VALIDATION", "boom");
      },
    };
    const guardedOrca = new Orca([fakeDetector], [throwingScaffolder], [], LocalRuntime.DIR);

    await expect(guardedOrca.scaffold(cwd, "fake", true)).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
    // Originals are intact and the partial scaffold output is gone.
    await expect(readFile(join(cwd, "keep.txt"), "utf8")).resolves.toBe("original");
    await expect(readFile(join(cwd, ".zitadel/local/runtime.json"), "utf8")).resolves.toContain(
      "localhost",
    );
    await expect(stat(join(cwd, "half-written.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("scaffolds beside the runtime start left without moving it, and leaves nothing behind", async ({
    dir,
  }) => {
    const cwd = await tmpPackageSafe(dir);
    await mkdir(join(cwd, ".zitadel/local"), { recursive: true });
    await writeFile(join(cwd, ".zitadel/local/runtime.json"), '{"server_url":"http://localhost"}');
    const ranIn: string[] = [];
    const watchingScaffolder: Scaffolder = {
      ...fakeScaffolder,
      async scaffold(scaffoldCwd) {
        ranIn.push(scaffoldCwd);
        await expect(stat(join(cwd, ".zitadel/local/runtime.json"))).resolves.toBeTruthy();
        await writeFile(join(scaffoldCwd, "package.json"), "{}");
      },
    };
    const watchingOrca = new Orca([fakeDetector], [watchingScaffolder], [], LocalRuntime.DIR);

    await watchingOrca.scaffold(cwd, "fake");

    expect(ranIn).toHaveLength(1);
    expect(ranIn[0]).not.toBe(cwd);
    expect(basename(ranIn[0] ?? "")).toBe(basename(cwd));
    expect(await readdir(dirname(cwd))).toEqual([basename(cwd)]);
  });

  it("leaves nothing beside the project when the scaffold fails", async ({ dir }) => {
    const cwd = await tmpPackageSafe(dir);
    await mkdir(join(cwd, ".zitadel/local"), { recursive: true });
    const failingScaffolder: Scaffolder = {
      ...fakeScaffolder,
      async scaffold() {
        throw new ZitadelError("E_VALIDATION", "boom");
      },
    };
    const failingOrca = new Orca([fakeDetector], [failingScaffolder], [], LocalRuntime.DIR);

    await expect(failingOrca.scaffold(cwd, "fake")).rejects.toMatchObject({ code: "E_VALIDATION" });

    expect(await readdir(dirname(cwd))).toEqual([basename(cwd)]);
    expect(await readdir(cwd)).toEqual([".zitadel"]);
  });

  it("refuses a non-empty directory without force", async ({ dir }) => {
    const cwd = await tmpPackageSafe(dir);
    await writeFile(join(cwd, ".gitignore"), "x\n");
    await expect(fakeOrca.scaffold(cwd, "fake")).rejects.toMatchObject({ category: "conflict" });
  });

  it("throws E_CONFLICT when the directory already contains a project", async ({ dir }) => {
    const cwd = dir;
    await writeFile(join(cwd, "package.json"), "{}");
    await expect(fakeOrca.scaffold(cwd, "fake")).rejects.toMatchObject({ category: "conflict" });
  });

  it("leaves a folder with an invalid package name as it was when the scaffolder fails in its subfolder", async ({
    dir,
  }) => {
    const parent = dir;
    const cwd = join(parent, "Tmp.W4SK1wDYDb");
    await mkdir(cwd);
    class Failing extends AbstractCLIScaffolder {
      readonly displayName = "Failing";
      readonly supportedFrameworks = ["fake"];
      readonly nodeEngines: NodeEngines = {
        label: "failing-cli",
        spec: "failing-cli@1.0.0",
        fallback: ">=20",
        enforcement: "warn",
      };
      protected async create(createCwd: string): Promise<void> {
        await writeFile(join(createCwd, "half-written.txt"), "junk");
        throw new ZitadelError("E_VALIDATION", "boom");
      }
    }
    const failingOrca = new Orca([fakeDetector], [new Failing()], [], LocalRuntime.DIR);

    await expect(failingOrca.scaffold(cwd, "fake")).rejects.toMatchObject({ code: "E_VALIDATION" });
    expect(await readdir(cwd)).toEqual([]);
  });

  it("leaves no directory behind when a scaffold into a new one fails", async ({ dir }) => {
    const parent = dir;
    const failingOrca = new Orca(
      [fakeDetector],
      [
        {
          ...fakeScaffolder,
          async scaffold(scaffoldCwd) {
            await writeFile(join(scaffoldCwd, "half-written.txt"), "junk");
            throw new ZitadelError("E_VALIDATION", "boom");
          },
        },
      ],
      [],
      LocalRuntime.DIR,
    );

    await expect(
      failingOrca.scaffold(join(parent, "shop", "my-zitadel-app"), "fake"),
    ).rejects.toMatchObject({ code: "E_VALIDATION" });
    await expect(readdir(parent)).resolves.toEqual([]);
  });

  it("removes what a failed scaffold left in an empty directory", async ({ dir }) => {
    const cwd = await tmpPackageSafe(dir);
    const failingOrca = new Orca(
      [fakeDetector],
      [
        {
          ...fakeScaffolder,
          async scaffold(scaffoldCwd) {
            await writeFile(join(scaffoldCwd, "half-written.txt"), "junk");
            throw new ZitadelError("E_VALIDATION", "boom");
          },
        },
      ],
      [],
      LocalRuntime.DIR,
    );

    await expect(failingOrca.scaffold(cwd, "fake")).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
    await expect(readdir(cwd)).resolves.toEqual([]);
  });

  describe("undoably", () => {
    /** A scaffold that writes its own `.gitignore` and `package.json`, as the generators do. */
    const generatorOrca = new Orca(
      [fakeDetector],
      [
        {
          ...fakeScaffolder,
          async scaffold(scaffoldCwd) {
            await writeFile(join(scaffoldCwd, ".gitignore"), "node_modules\n");
            await writeFile(join(scaffoldCwd, "package.json"), "{}");
          },
        },
      ],
      [],
      LocalRuntime.DIR,
    );

    it("puts back what start left, without what was written after the scaffold", async ({
      dir,
    }) => {
      const cwd = await tmpPackageSafe(dir);
      await writeFile(join(cwd, ".gitignore"), ".zitadel/local/\n");
      await mkdir(join(cwd, ".zitadel/local"), { recursive: true });
      await writeFile(join(cwd, ".zitadel/local/runtime.json"), "{}");
      const scaffold = await generatorOrca.scaffoldUndoably(cwd, "fake");
      await writeFile(join(cwd, "zitadel.json"), "{}");
      await writeFile(join(cwd, ".zitadel/secret"), "{}");

      await scaffold.undo();

      await expect(readdir(cwd)).resolves.toEqual([".gitignore", ".zitadel"]);
      await expect(readdir(join(cwd, ".zitadel"))).resolves.toEqual(["local"]);
      await expect(readFile(join(cwd, ".gitignore"), "utf8")).resolves.toBe(".zitadel/local/\n");
      await expect(readFile(join(cwd, ".zitadel/local/runtime.json"), "utf8")).resolves.toBe("{}");
    });

    it("puts back the files the scaffold replaced with force", async ({ dir }) => {
      const cwd = await tmpPackageSafe(dir);
      await writeFile(join(cwd, "package.json"), "mine");
      await writeFile(join(cwd, "notes.txt"), "mine");
      const scaffold = await generatorOrca.scaffoldUndoably(cwd, "fake", true);

      await scaffold.undo();

      await expect(readdir(cwd)).resolves.toEqual(["notes.txt", "package.json"]);
      await expect(readFile(join(cwd, "package.json"), "utf8")).resolves.toBe("mine");
    });

    it("leaves nothing beside the directory once undone", async ({ dir }) => {
      const cwd = await tmpPackageSafe(dir);
      await writeFile(join(cwd, "package.json"), "mine");
      const scaffold = await generatorOrca.scaffoldUndoably(cwd, "fake", true);

      await scaffold.undo();

      await expect(readdir(dirname(cwd))).resolves.toEqual([basename(cwd)]);
    });

    it("keeps the new app, and nothing beside the directory, once kept", async ({ dir }) => {
      const cwd = await tmpPackageSafe(dir);
      await writeFile(join(cwd, "package.json"), "mine");
      const scaffold = await generatorOrca.scaffoldUndoably(cwd, "fake", true);

      await scaffold.keep();

      await expect(readFile(join(cwd, "package.json"), "utf8")).resolves.toBe("{}");
      await expect(readdir(dirname(cwd))).resolves.toEqual([basename(cwd)]);
    });

    it("creates a directory that does not exist yet", async ({ dir }) => {
      const cwd = join(dir, "shop", "my-zitadel-app");

      const scaffold = await generatorOrca.scaffoldUndoably(cwd, "fake");
      await scaffold.keep();

      await expect(readdir(cwd)).resolves.toEqual([".gitignore", "package.json"]);
    });

    it("removes the directories it created once undone", async ({ dir }) => {
      const parent = dir;
      const scaffold = await generatorOrca.scaffoldUndoably(
        join(parent, "shop", "my-zitadel-app"),
        "fake",
      );

      await scaffold.undo();

      await expect(readdir(parent)).resolves.toEqual([]);
    });

    it("undoes a scaffold whose app it cannot detect", async ({ dir }) => {
      const cwd = await tmpPackageSafe(dir);
      await writeFile(join(cwd, ".gitignore"), ".zitadel/local/\n");
      const undetectableOrca = new Orca(
        [fakeDetector],
        [
          {
            ...fakeScaffolder,
            async scaffold(scaffoldCwd) {
              await writeFile(join(scaffoldCwd, "index.html"), "<p>not an app</p>");
            },
          },
        ],
        [],
        LocalRuntime.DIR,
      );

      await expect(undetectableOrca.scaffoldUndoably(cwd, "fake")).rejects.toMatchObject({
        name: "OrcaFrameworkMissingError",
      });
      await expect(readdir(cwd)).resolves.toEqual([".gitignore"]);
    });
  });
});

describe("Orca.planScaffold", () => {
  it("describes the new app without touching the directory", async ({ dir }) => {
    const cwd = await tmpPackageSafe(dir);

    await expect(orca.planScaffold(cwd, "next")).resolves.toEqual({
      framework: "next",
      devPort: DEFAULT_DEV_PORT,
    });
    await expect(readdir(cwd)).resolves.toEqual([]);
  });

  it("leaves a directory that does not exist yet uncreated", async ({ dir }) => {
    const cwd = join(dir, "my-zitadel-app");

    await orca.planScaffold(cwd, "next");

    await expect(stat(cwd)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("offers the dev port a .env file in the directory declares", async ({ dir }) => {
    const cwd = await tmpPackageSafe(dir);
    await writeFile(join(cwd, ".env.local"), "PORT=4321\n");

    await expect(orca.planScaffold(cwd, "next")).resolves.toMatchObject({ devPort: 4321 });
  });

  it("plans a new app in a directory name npm does not accept", async ({ dir }) => {
    const cwd = join(dir, "Zitadel-Orca-Bad");
    await mkdir(cwd);

    await expect(orca.planScaffold(cwd, "next")).resolves.toMatchObject({ framework: "next" });
  });

  it("refuses a framework it could create but not integrate", async ({ dir }) => {
    const cwd = await tmpPackageSafe(dir);
    const withoutPatchers = new Orca(detectors, scaffolders, [], LocalRuntime.DIR);

    await expect(withoutPatchers.planScaffold(cwd, "next")).rejects.toMatchObject({
      category: "internal",
      message: 'No patcher supports "next"',
    });
  });
});

describe("isDirectoryOrMissing", () => {
  it("accepts a directory", async ({ dir }) => {
    await expect(isDirectoryOrMissing(dir)).resolves.toBe(true);
  });

  it("accepts a path that does not exist yet", async ({ dir }) => {
    await expect(isDirectoryOrMissing(join(dir, "shop", "web"))).resolves.toBe(true);
  });

  it.for([
    ["a file", (file: string) => file],
    ["a path under a file", (file: string) => join(file, "web")],
  ] as const)("does not accept %s", async ([_name, under], { dir }) => {
    const file = join(dir, "notes.txt");
    await writeFile(file, "");

    await expect(isDirectoryOrMissing(under(file))).resolves.toBe(false);
  });
});
