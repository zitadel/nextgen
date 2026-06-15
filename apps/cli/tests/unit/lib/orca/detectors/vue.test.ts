import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { VueDetector } from "../../../../../src/lib/orca/detectors/vue";

const dirs: string[] = [];

async function project(deps: Record<string, string>): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "vue-detect-"));
  dirs.push(cwd);
  await writeFile(join(cwd, "package.json"), JSON.stringify({ dependencies: deps }));
  return cwd;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("VueDetector", () => {
  it("recognises a Vite + Vue app and reports appDir 'src'", async () => {
    const facts = await new VueDetector().detect(await project({ vue: "^3", vite: "^5" }));
    expect(facts?.id).toBe("vue");
    expect(facts?.appDir).toBe("src");
  });

  it("excludes Nuxt (which ships Vue) so NuxtDetector wins", async () => {
    expect(
      await new VueDetector().detect(await project({ nuxt: "^4", vue: "^3", vite: "^5" })),
    ).toBeNull();
  });

  it("returns null without vite", async () => {
    expect(await new VueDetector().detect(await project({ vue: "^3" }))).toBeNull();
  });

  it("returns null without vue", async () => {
    expect(await new VueDetector().detect(await project({ vite: "^5" }))).toBeNull();
  });
});
