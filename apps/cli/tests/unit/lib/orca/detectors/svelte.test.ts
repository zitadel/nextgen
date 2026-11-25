import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { SvelteDetector } from "@/lib/orca/detectors/svelte";
import { it } from "@tests/fixtures";

/**
 * Writes a package.json that declares the dependencies.
 *
 * @param cwd - The project directory.
 * @param deps - The dependencies it declares.
 * @returns The project directory.
 */
async function project(cwd: string, deps: Record<string, string>): Promise<string> {
  await writeFile(join(cwd, "package.json"), JSON.stringify({ dependencies: deps }));
  return cwd;
}

describe("SvelteDetector", () => {
  it("recognises a Vite + Svelte app and reports appDir 'src'", async ({ dir }) => {
    const facts = await new SvelteDetector().detect(
      await project(dir, { svelte: "^5", vite: "^5" }),
    );
    expect(facts?.id).toBe("svelte");
    expect(facts?.appDir).toBe("src");
  });

  it("excludes SvelteKit (which ships Svelte)", async ({ dir }) => {
    expect(
      await new SvelteDetector().detect(
        await project(dir, { "@sveltejs/kit": "^3", svelte: "^5", vite: "^5" }),
      ),
    ).toBeNull();
  });

  it("returns null without vite", async ({ dir }) => {
    expect(await new SvelteDetector().detect(await project(dir, { svelte: "^5" }))).toBeNull();
  });

  it("returns null without svelte", async ({ dir }) => {
    expect(await new SvelteDetector().detect(await project(dir, { vite: "^5" }))).toBeNull();
  });
});

describe("SvelteDetector version floor", () => {
  it("refuses a Svelte 4 app, which cannot run the Svelte 5 widgets", async ({ dir }) => {
    await expect(
      new SvelteDetector().detect(await project(dir, { svelte: "^4", vite: "^5" })),
    ).rejects.toMatchObject({
      category: "invalid",
    });
  });

  it("accepts a spec that may resolve to a supported version", async ({ dir }) => {
    expect(
      await new SvelteDetector().detect(await project(dir, { svelte: ">=4", vite: "^5" })),
    ).not.toBeNull();
  });
});
