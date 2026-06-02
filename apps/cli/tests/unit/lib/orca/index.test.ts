import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { Orca } from "../../../../src/lib/orca";
import type { Detector } from "../../../../src/lib/orca";
import { detectors } from "../../../../src/lib/orca/detectors";
import { patchers } from "../../../../src/lib/orca/patchers";
import type { Scaffolder } from "../../../../src/lib/orca/scaffolders/types";
import { scaffolders } from "../../../../src/lib/orca/scaffolders";

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

  it("throws E_VALIDATION for an unsupported framework", () => {
    expect(() => orca.scaffolderFor("svelte")).toThrowError(/No scaffolder/);
    expect(() => orca.patcherFor("svelte")).toThrowError(/No patcher/);
  });

  it("derives available frameworks from the scaffolder registry", () => {
    expect(orca.availableFrameworks().map((choice) => choice.id)).toEqual(["next"]);
  });
});

describe("Orca detection", () => {
  it("detects a Next project and extracts facts", async () => {
    const cwd = await nextProject();
    await writeFile(join(cwd, "package.json"), JSON.stringify({ scripts: { dev: "next dev -p 4321" }, dependencies: { next: "^15" } }));
    expect(await orca.detect(cwd)).toEqual({
      id: "next",
      appDir: "app",
      devPort: 4321,
      url: "http://localhost:4321",
    });
  });

  it("throws E_FRAMEWORK_NOT_DETECTED when nothing matches", async () => {
    await expect(orca.detect(await tmp())).rejects.toMatchObject({
      code: "E_FRAMEWORK_NOT_DETECTED",
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

  it("isEmpty reflects the presence of package.json", async () => {
    expect(await orca.isEmpty(await tmp())).toBe(true);
    expect(await orca.isEmpty(await nextProject())).toBe(false);
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
    const cwd = await tmp();
    expect(await fakeOrca.scaffold(cwd, "fake")).toMatchObject({ id: "fake" });
    await expect(readFile(join(cwd, "package.json"), "utf8")).resolves.toBe("{}");
  });

  it("throws E_CONFLICT when the directory already contains a project", async () => {
    const cwd = await tmp();
    await writeFile(join(cwd, "package.json"), "{}");
    await expect(fakeOrca.scaffold(cwd, "fake")).rejects.toMatchObject({ code: "E_CONFLICT" });
  });
});
