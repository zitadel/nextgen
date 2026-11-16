import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { SolidDetector } from "@/lib/orca/detectors/solid";
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

describe("SolidDetector", () => {
  it("recognises a Vite + Solid app and reports appDir 'src'", async ({ dir }) => {
    const facts = await new SolidDetector().detect(
      await project(dir, { "solid-js": "^1", vite: "^5" }),
    );
    expect(facts?.id).toBe("solid");
    expect(facts?.appDir).toBe("src");
  });

  it("excludes SolidStart (which ships Solid)", async ({ dir }) => {
    expect(
      await new SolidDetector().detect(
        await project(dir, { "@solidjs/start": "^1", "solid-js": "^1", vite: "^5" }),
      ),
    ).toBeNull();
  });

  it("returns null without vite", async ({ dir }) => {
    expect(await new SolidDetector().detect(await project(dir, { "solid-js": "^1" }))).toBeNull();
  });

  it("returns null without solid-js", async ({ dir }) => {
    expect(await new SolidDetector().detect(await project(dir, { vite: "^5" }))).toBeNull();
  });
});
