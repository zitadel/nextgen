import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { detectEmptyProject, tryDetectFramework } from "../../../../src/lib/orca/detect";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tmp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zitadel-orca-detect-"));
  dirs.push(dir);
  return dir;
}

describe("detectEmptyProject", () => {
  it("is true when no package.json exists", async () => {
    expect(await detectEmptyProject(await tmp())).toBe(true);
  });

  it("is false when a package.json exists", async () => {
    const cwd = await tmp();
    await writeFile(join(cwd, "package.json"), "{}");
    expect(await detectEmptyProject(cwd)).toBe(false);
  });
});

describe("tryDetectFramework", () => {
  it("returns null when no framework can be detected", async () => {
    expect(await tryDetectFramework(await tmp())).toBeNull();
  });

  it("detects a Next.js project without throwing", async () => {
    const cwd = await tmp();
    await mkdir(join(cwd, "app"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ dependencies: { next: "^15" } }),
    );
    expect(await tryDetectFramework(cwd)).toMatchObject({ id: "next" });
  });
});
