import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { NuxtDetector } from "../../../../../src/lib/orca/detectors/nuxt";

const dirs: string[] = [];

async function project(opts: { appDir?: boolean; nuxt?: boolean } = {}): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "nuxt-detect-"));
  dirs.push(cwd);
  const dep = opts.nuxt === false ? { vue: "^3" } : { nuxt: "^4" };
  await writeFile(join(cwd, "package.json"), JSON.stringify({ dependencies: dep }));
  if (opts.appDir) {
    await mkdir(join(cwd, "app"));
  }
  return cwd;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("NuxtDetector", () => {
  it("reports appDir 'app' when an app/ srcDir exists (Nuxt 4)", async () => {
    const facts = await new NuxtDetector().detect(await project({ appDir: true }));
    expect(facts?.id).toBe("nuxt");
    expect(facts?.appDir).toBe("app");
  });

  it("reports appDir '.' for a root-layout project (Nuxt 3)", async () => {
    const facts = await new NuxtDetector().detect(await project({ appDir: false }));
    expect(facts?.appDir).toBe(".");
  });

  it("returns null without a nuxt dependency", async () => {
    expect(await new NuxtDetector().detect(await project({ nuxt: false }))).toBeNull();
  });
});
