import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { NuxtDetector } from "@/lib/orca/detectors/nuxt";
import { it } from "@tests/fixtures";

/**
 * Writes a Nuxt (or Vue-only) `package.json` and the named folders.
 *
 * @param cwd - The directory to write them in.
 * @param opts - Whether it depends on Nuxt, and which folders it holds.
 * @returns The directory.
 */
async function project(
  cwd: string,
  opts: { nuxt?: boolean; dirs?: string[] } = {},
): Promise<string> {
  const dep = opts.nuxt === false ? { vue: "^3" } : { nuxt: "^4" };
  await writeFile(join(cwd, "package.json"), JSON.stringify({ dependencies: dep }));
  for (const dir of opts.dirs ?? []) {
    await mkdir(join(cwd, dir));
  }
  return cwd;
}

describe("NuxtDetector", () => {
  it("reports appDir 'app' for a Nuxt 4 project", async ({ dir }) => {
    const facts = await new NuxtDetector().detect(await project(dir));
    expect(facts?.id).toBe("nuxt");
    expect(facts?.appDir).toBe("app");
  });

  it("reports appDir 'app' when an app/ srcDir exists", async ({ dir }) => {
    const facts = await new NuxtDetector().detect(await project(dir, { dirs: ["app", "pages"] }));
    expect(facts?.appDir).toBe("app");
  });

  it.for(["pages", "plugins", "layouts", "middleware", "assets"])(
    "reports appDir '.' for a Nuxt 4 root-layout project with a root %s/",
    async (folder, { dir }) => {
      const facts = await new NuxtDetector().detect(await project(dir, { dirs: [folder] }));
      expect(facts?.appDir).toBe(".");
    },
  );

  it("returns null without a nuxt dependency", async ({ dir }) => {
    expect(await new NuxtDetector().detect(await project(dir, { nuxt: false }))).toBeNull();
  });
});
