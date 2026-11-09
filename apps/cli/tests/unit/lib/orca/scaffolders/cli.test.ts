import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AbstractCLIScaffolder } from "@/lib/orca/scaffolders/cli";
import type { NodeEngines } from "@/lib/orca/scaffolders/node-engines";
import { SUPPORTED_NODE } from "@tests/helpers/node-engines";

vi.mock("execa", () => ({ execaSync: vi.fn(() => ({ failed: true, stdout: "" })) }));

/** Records where the framework CLI ran and writes a small app there, as it would. */
class RecordingScaffolder extends AbstractCLIScaffolder {
  readonly displayName = "Recording";
  readonly supportedFrameworks: ReadonlyArray<string> = ["recording"];
  readonly nodeEngines: NodeEngines = {
    label: "recording-cli",
    spec: "recording-cli@1.0.0",
    fallback: ">=20",
    enforcement: "warn",
  };
  readonly ranIn: string[] = [];

  protected async create(cwd: string): Promise<void> {
    this.ranIn.push(cwd);
    await mkdir(join(cwd, "app"));
    await writeFile(join(cwd, "app", "page.tsx"), "page\n");
    await writeFile(join(cwd, "package.json"), "{}\n");
  }
}

/** The same scaffolder for a framework CLI that accepts any folder name. */
class AnyFolderScaffolder extends RecordingScaffolder {
  protected override readonly requiresValidFolderName = false;
}

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function folderNamed(name: string): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "zitadel-cli-scaffolder-"));
  dirs.push(parent);
  const cwd = join(parent, name);
  await mkdir(cwd);
  return cwd;
}

describe("AbstractCLIScaffolder", () => {
  describe("in a folder whose name is a valid package name", () => {
    it("runs the framework CLI in the folder itself", async () => {
      const cwd = await folderNamed("my-app");
      const scaffolder = new RecordingScaffolder(SUPPORTED_NODE);

      await scaffolder.scaffold(cwd, "recording");

      expect(scaffolder.ranIn).toEqual([cwd]);
      expect((await readdir(cwd)).sort()).toEqual(["app", "package.json"]);
    });
  });

  describe("in a folder whose name is not a valid package name", () => {
    it("runs the framework CLI in a subfolder named as a valid package name", async () => {
      const cwd = await folderNamed("tmp.w4SK1wDYDb");
      const scaffolder = new RecordingScaffolder(SUPPORTED_NODE);

      await scaffolder.scaffold(cwd, "recording");

      expect(scaffolder.ranIn.map((ran) => basename(ran))).toEqual(["tmp-w4sk1wdydb"]);
    });

    it("moves what the framework CLI created up into the folder", async () => {
      const cwd = await folderNamed("tmp.w4SK1wDYDb");

      await new RecordingScaffolder(SUPPORTED_NODE).scaffold(cwd, "recording");

      expect((await readdir(cwd)).sort()).toEqual(["app", "package.json"]);
      expect(await readFile(join(cwd, "app", "page.tsx"), "utf8")).toBe("page\n");
    });

    it("cuts the subfolder's name to npm's 214 characters", async () => {
      const cwd = await folderNamed(`${"a".repeat(215)}.`);
      const scaffolder = new RecordingScaffolder(SUPPORTED_NODE);

      await scaffolder.scaffold(cwd, "recording");

      expect(scaffolder.ranIn.map((ran) => basename(ran))).toEqual(["a".repeat(214)]);
    });

    it("falls back to app when nothing of the name is usable", async () => {
      const cwd = await folderNamed("__");
      const scaffolder = new RecordingScaffolder(SUPPORTED_NODE);

      await scaffolder.scaffold(cwd, "recording");

      expect(scaffolder.ranIn.map((ran) => basename(ran))).toEqual(["app"]);
    });

    it("does not use a subfolder when the scaffolder takes any folder name", async () => {
      const cwd = await folderNamed("tmp.w4SK1wDYDb");
      const scaffolder = new AnyFolderScaffolder(SUPPORTED_NODE);

      await scaffolder.scaffold(cwd, "recording");

      expect(scaffolder.ranIn).toEqual([cwd]);
    });
  });
});
