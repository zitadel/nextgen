import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  detectProjectFacts,
  formatFrameworkLine,
  relativeDisplayPath,
} from "../../../../src/commands/setup/summary";

describe("relativeDisplayPath", () => {
  it("normalizes Windows paths for repository-style suffix matching", () => {
    const displayed = relativeDisplayPath(
      "C:\\repo",
      "C:\\repo\\.zitadel\\schemas\\default-human-user.json",
    );

    expect(displayed).toBe(".zitadel/schemas/default-human-user.json");
    expect(displayed.endsWith(".zitadel/schemas/default-human-user.json")).toBe(true);
  });

  it("does not strip a sibling path that merely shares the cwd prefix", () => {
    expect(relativeDisplayPath("C:\\repo", "C:\\repository\\file.json")).toBe(
      "C:/repository/file.json",
    );
  });
});

describe("detectProjectFacts", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  async function app(devDependencies: Record<string, string>): Promise<string> {
    const cwd = await mkdtemp(join(tmpdir(), "summary-facts-"));
    dirs.push(cwd);
    await writeFile(join(cwd, "package.json"), JSON.stringify({ devDependencies }));
    return cwd;
  }

  // The version comes from the framework's own package, not its CLI id.
  it.each([
    ["next", "next", "Next.js 3.0.1"],
    ["nuxt", "nuxt", "Nuxt 3.0.1"],
    ["react", "react", "React 3.0.1"],
    ["vue", "vue", "Vue 3.0.1"],
    ["angular", "@angular/core", "Angular 3.0.1"],
    ["solid", "solid-js", "Solid 3.0.1"],
    ["svelte", "svelte", "Svelte 3.0.1"],
    ["qwik", "@qwik.dev/core", "Qwik 3.0.1"],
  ])("names %s with the version of %s", async (framework, dependency, line) => {
    const facts = await detectProjectFacts(await app({ [dependency]: "^3.0.1" }), framework);

    expect(formatFrameworkLine({ ...facts, typescript: false })).toMatch(new RegExp(`^${line} `));
  });
});
