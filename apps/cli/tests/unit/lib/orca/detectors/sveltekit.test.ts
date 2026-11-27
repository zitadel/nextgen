import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { it } from "@tests/fixtures";
import { SvelteKitDetector } from "@/lib/orca/detectors/sveltekit";

/**
 * Writes a `package.json` with the dependencies into a directory.
 *
 * @param cwd - The directory to make the project in.
 * @param deps - The project's dependencies.
 * @returns The directory.
 */
async function project(cwd: string, deps: Record<string, string>): Promise<string> {
  await writeFile(join(cwd, "package.json"), JSON.stringify({ dependencies: deps }));
  return cwd;
}

describe("SvelteKitDetector", () => {
  it("recognises a SvelteKit app by @sveltejs/kit and reports appDir 'src'", async ({ dir }) => {
    const facts = await new SvelteKitDetector().detect(
      await project(dir, { "@sveltejs/kit": "^3", svelte: "^5", vite: "^8" }),
    );
    expect(facts?.id).toBe("sveltekit");
    expect(facts?.appDir).toBe("src");
  });

  it("returns null for a bare Svelte SPA (no @sveltejs/kit)", async ({ dir }) => {
    expect(
      await new SvelteKitDetector().detect(await project(dir, { svelte: "^5", vite: "^5" })),
    ).toBeNull();
  });

  it("returns null without a package.json", async ({ dir }) => {
    expect(await new SvelteKitDetector().detect(dir)).toBeNull();
  });
});

describe("SvelteKitDetector version floor", () => {
  it("refuses a SvelteKit 2 app, which has no $app/env/private", async ({ dir }) => {
    await expect(
      new SvelteKitDetector().detect(
        await project(dir, { "@sveltejs/kit": "^2", svelte: "^5", vite: "^7" }),
      ),
    ).rejects.toMatchObject({
      code: "E_UNSUPPORTED_PROJECT_SHAPE",
    });
  });

  it("refuses a Svelte 4 app, which cannot run the Svelte 5 widgets", async ({ dir }) => {
    await expect(
      new SvelteKitDetector().detect(
        await project(dir, { "@sveltejs/kit": "^3", svelte: "^4", vite: "^5" }),
      ),
    ).rejects.toMatchObject({
      code: "E_UNSUPPORTED_PROJECT_SHAPE",
    });
  });

  it("accepts a spec that may resolve to a supported version", async ({ dir }) => {
    expect(
      await new SvelteKitDetector().detect(
        await project(dir, { "@sveltejs/kit": "^3", svelte: ">=4", vite: "^5" }),
      ),
    ).not.toBeNull();
  });
});
