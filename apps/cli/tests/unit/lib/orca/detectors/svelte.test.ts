import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SvelteDetector } from "../../../../../src/lib/orca/detectors/svelte";

const dirs: string[] = [];

async function project(deps: Record<string, string>): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "svelte-detect-"));
  dirs.push(cwd);
  await writeFile(join(cwd, "package.json"), JSON.stringify({ dependencies: deps }));
  return cwd;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("SvelteDetector", () => {
  it("recognises a Vite + Svelte app and reports appDir 'src'", async () => {
    const facts = await new SvelteDetector().detect(await project({ svelte: "^5", vite: "^5" }));
    expect(facts?.id).toBe("svelte");
    expect(facts?.appDir).toBe("src");
  });

  it("excludes SvelteKit (which ships Svelte)", async () => {
    expect(
      await new SvelteDetector().detect(
        await project({ "@sveltejs/kit": "^2", svelte: "^5", vite: "^5" }),
      ),
    ).toBeNull();
  });

  it("returns null without vite", async () => {
    expect(await new SvelteDetector().detect(await project({ svelte: "^5" }))).toBeNull();
  });

  it("returns null without svelte", async () => {
    expect(await new SvelteDetector().detect(await project({ vite: "^5" }))).toBeNull();
  });
});

describe("SvelteDetector version floor", () => {
  it("refuses a Svelte 4 app, which cannot run the Svelte 5 widgets", async () => {
    await expect(
      new SvelteDetector().detect(await project({ svelte: "^4", vite: "^5" })),
    ).rejects.toMatchObject({
      code: "E_UNSUPPORTED_PROJECT_SHAPE",
    });
  });

  it("accepts a spec that may resolve to a supported version", async () => {
    expect(
      await new SvelteDetector().detect(await project({ svelte: ">=4", vite: "^5" })),
    ).not.toBeNull();
  });
});
