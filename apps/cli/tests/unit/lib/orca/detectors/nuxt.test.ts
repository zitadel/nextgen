import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { NuxtDetector } from "../../../../../src/lib/orca/detectors/nuxt";

const dirs: string[] = [];

async function project(opts: { nuxt?: boolean } = {}): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "nuxt-detect-"));
  dirs.push(cwd);
  const dep = opts.nuxt === false ? { vue: "^3" } : { nuxt: "^4" };
  await writeFile(join(cwd, "package.json"), JSON.stringify({ dependencies: dep }));
  return cwd;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("NuxtDetector", () => {
  it("reports appDir 'app' for a Nuxt 4 project", async () => {
    const facts = await new NuxtDetector().detect(await project());
    expect(facts?.id).toBe("nuxt");
    expect(facts?.appDir).toBe("app");
  });

  it("returns null without a nuxt dependency", async () => {
    expect(await new NuxtDetector().detect(await project({ nuxt: false }))).toBeNull();
  });
});
