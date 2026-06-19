import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Orca } from "../../../../src/lib/orca";
import type { Detector } from "../../../../src/lib/orca";
import { detectors } from "../../../../src/lib/orca/detectors";
import { patchers } from "../../../../src/lib/orca/patchers";
import { scaffolders } from "../../../../src/lib/orca/scaffolders";
import type { Scaffolder } from "../../../../src/lib/orca/scaffolders/types";

const orca = new Orca(detectors, scaffolders, patchers);

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function tmp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zitadel-orca-"));
  dirs.push(dir);
  return dir;
}
async function tmpPackageSafe(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "zitadel-orca-"));
  dirs.push(parent);
  const dir = join(parent, "my-zitadel-app");
  await mkdir(dir);
  return dir;
}
async function nextProject(): Promise<string> {
  const cwd = await tmp();
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

  it("throws E_VALIDATION for an unsupported framework", () => {
    expect(() => orca.scaffolderFor("ember")).toThrowError(/No scaffolder/);
    expect(() => orca.patcherFor("ember")).toThrowError(/No patcher/);
  });

  it("derives available frameworks from the scaffolder registry", () => {
    expect(orca.availableFrameworks().map((choice) => choice.id)).toEqual([
      "next",
      "nuxt",
      "react",
      "vue",
      "solid",
      "svelte",
      "qwik",
      "angular",
    ]);
  });
});

describe("Orca detection", () => {
  it("detects a Next project and extracts facts", async () => {
    const cwd = await nextProject();
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

  it("throws E_FRAMEWORK_NOT_DETECTED when nothing matches", async () => {
    await expect(orca.detect(await tmp())).rejects.toMatchObject({
      code: "E_FRAMEWORK_NOT_DETECTED",
      message: "Could not detect a supported app framework",
      hint: "Run setup from your app project directory, pass --cwd <path-to-app>, or run setup from an empty directory to scaffold a new app.",
    });
  });

  it("throws E_FRAMEWORK_NOT_DETECTED for an unsupported requested framework", async () => {
    await expect(orca.detect(await tmp(), "svelte")).rejects.toMatchObject({
      code: "E_FRAMEWORK_NOT_DETECTED",
    });
  });

  it("tryDetect returns undefined instead of throwing", async () => {
    expect(await orca.tryDetect(await tmp())).toBeUndefined();
    expect(await orca.tryDetect(await nextProject())).toMatchObject({ id: "next" });
  });

  it("treats an empty directory as a fresh scaffold target", async () => {
    expect(await orca.isFreshScaffoldTarget(await tmp())).toBe(true);
  });

  it("allows .gitignore in a fresh scaffold target", async () => {
    const cwd = await tmp();
    await writeFile(join(cwd, ".gitignore"), ".zitadel/local/\n");

    expect(await orca.isFreshScaffoldTarget(cwd)).toBe(true);
  });

  it("allows runtime-only .zitadel/local state in a fresh scaffold target", async () => {
    const cwd = await tmp();
    await writeFile(join(cwd, ".gitignore"), ".zitadel/local/\n");
    await mkdir(join(cwd, ".zitadel/local"), { recursive: true });
    await writeFile(join(cwd, ".zitadel/local/runtime.json"), "{}");

    expect(await orca.isFreshScaffoldTarget(cwd)).toBe(true);
  });

  it("rejects project state and arbitrary files as fresh scaffold targets", async () => {
    const withSecret = await tmp();
    await mkdir(join(withSecret, ".zitadel"), { recursive: true });
    await writeFile(join(withSecret, ".zitadel/secret"), "{}");

    const withReadme = await tmp();
    await writeFile(join(withReadme, "README.md"), "not empty");

    const withPackageJson = await nextProject();

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
  const fakeOrca = new Orca([fakeDetector], [fakeScaffolder], []);

  it("scaffolds into an empty dir and re-detects the result", async () => {
    const cwd = await tmpPackageSafe();
    expect(await fakeOrca.scaffold(cwd, "fake")).toMatchObject({ id: "fake" });
    await expect(readFile(join(cwd, "package.json"), "utf8")).resolves.toBe("{}");
  });

  it("scaffolds in place while preserving runtime-only .zitadel/local state", async () => {
    const cwd = await tmpPackageSafe();
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
    const guardedOrca = new Orca([fakeDetector], [guardedScaffolder], []);

    await expect(guardedOrca.scaffold(cwd, "fake")).resolves.toMatchObject({ id: "fake" });
    await expect(readFile(join(cwd, "package.json"), "utf8")).resolves.toBe("{}");
    await expect(readFile(join(cwd, ".zitadel/local/runtime.json"), "utf8")).resolves.toContain(
      "localhost",
    );
    await expect(readFile(join(cwd, ".gitignore"), "utf8")).resolves.toBe(
      "node_modules\n.zitadel/local/\n",
    );
    await expect(stat(join(cwd, "myapp"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("throws E_CONFLICT when the directory already contains a project", async () => {
    const cwd = await tmp();
    await writeFile(join(cwd, "package.json"), "{}");
    await expect(fakeOrca.scaffold(cwd, "fake")).rejects.toMatchObject({ code: "E_CONFLICT" });
  });

  it("rejects npm-invalid fresh directory names before running the scaffolder", async () => {
    const parent = await mkdtemp(join(tmpdir(), "zitadel-orca-invalid-"));
    dirs.push(parent);
    const cwd = join(parent, "Zitadel-Orca-Bad");
    await mkdir(cwd);
    const scaffold = vi.fn(async (scaffoldCwd: string) => {
      await writeFile(join(scaffoldCwd, "package.json"), "{}");
    });
    const invalidNameOrca = new Orca([fakeDetector], [{ ...fakeScaffolder, scaffold }], []);

    await expect(invalidNameOrca.scaffold(cwd, "fake")).rejects.toMatchObject({
      code: "E_VALIDATION",
      hint: expect.stringContaining("lowercase npm-package-safe"),
      details: expect.objectContaining({
        name: expect.stringContaining("Zitadel-Orca-Bad"),
        validation_errors: expect.arrayContaining([
          "name can no longer contain capital letters",
        ]),
      }),
    });
    expect(scaffold).not.toHaveBeenCalled();
  });
});
