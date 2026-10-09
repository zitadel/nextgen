import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SvelteKitDetector } from "../../../../../src/lib/orca/detectors/sveltekit";

const dirs: string[] = [];

async function project(deps: Record<string, string>): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "sveltekit-detect-"));
  dirs.push(cwd);
  await writeFile(join(cwd, "package.json"), JSON.stringify({ dependencies: deps }));
  return cwd;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("SvelteKitDetector", () => {
  it("recognises a SvelteKit app by @sveltejs/kit and reports appDir 'src'", async () => {
    const facts = await new SvelteKitDetector().detect(
      await project({ "@sveltejs/kit": "^2", svelte: "^5", vite: "^8" }),
    );
    expect(facts?.id).toBe("sveltekit");
    expect(facts?.appDir).toBe("src");
  });

  it("returns null for a bare Svelte SPA (no @sveltejs/kit)", async () => {
    expect(
      await new SvelteKitDetector().detect(await project({ svelte: "^5", vite: "^5" })),
    ).toBeNull();
  });

  it("returns null without a package.json", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "sveltekit-empty-"));
    dirs.push(cwd);
    expect(await new SvelteKitDetector().detect(cwd)).toBeNull();
  });
});
