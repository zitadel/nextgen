import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { OrcaError } from "@/lib/orca";
import { VueDetector } from "@/lib/orca/detectors/vue";
import { it } from "@tests/fixtures";
import { rejectionOf } from "@tests/helpers/thrown-value";

async function project(cwd: string, deps: Record<string, string>): Promise<string> {
  await writeFile(join(cwd, "package.json"), JSON.stringify({ dependencies: deps }));
  return cwd;
}

describe("VueDetector", () => {
  it("recognises a Vite + Vue app and reports appDir 'src'", async ({ dir }) => {
    const facts = await new VueDetector().detect(await project(dir, { vue: "^3", vite: "^5" }));
    expect(facts?.id).toBe("vue");
    expect(facts?.appDir).toBe("src");
  });

  it("excludes Nuxt (which ships Vue) so NuxtDetector wins", async ({ dir }) => {
    expect(
      await new VueDetector().detect(await project(dir, { nuxt: "^4", vue: "^3", vite: "^5" })),
    ).toBeNull();
  });

  it("returns null without vite", async ({ dir }) => {
    expect(await new VueDetector().detect(await project(dir, { vue: "^3" }))).toBeNull();
  });

  it("returns null without vue", async ({ dir }) => {
    expect(await new VueDetector().detect(await project(dir, { vite: "^5" }))).toBeNull();
  });

  it("refuses Vue 3.1, below the 3.2 floor", async ({ dir }) => {
    const caught = await rejectionOf(async () =>
      new VueDetector().detect(await project(dir, { vue: "~3.1.0", vite: "^5" })),
    );
    expect(caught).toBeInstanceOf(OrcaError);
    expect((caught as OrcaError).category).toBe("invalid");
  });

  it("accepts Vue 3.2", async ({ dir }) => {
    const facts = await new VueDetector().detect(await project(dir, { vue: "^3.2.0", vite: "^5" }));
    expect(facts?.id).toBe("vue");
  });
});
