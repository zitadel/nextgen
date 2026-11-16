import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { SolidStartDetector } from "@/lib/orca/detectors/solid-start";
import { it } from "@tests/helpers/fixtures";

/**
 * Writes a `package.json` declaring the given dependencies.
 *
 * @param cwd - The directory to write it in.
 * @param deps - The dependencies it declares.
 * @returns The directory.
 */
async function project(cwd: string, deps: Record<string, string>): Promise<string> {
  await writeFile(join(cwd, "package.json"), JSON.stringify({ dependencies: deps }));
  return cwd;
}

describe("SolidStartDetector", () => {
  it("recognises a SolidStart app by solid-js + @solidjs/start and reports appDir 'src'", async ({
    dir,
  }) => {
    const facts = await new SolidStartDetector().detect(
      await project(dir, { "solid-js": "^1", "@solidjs/start": "^2", vite: "^8" }),
    );
    expect(facts?.id).toBe("solid-start");
    expect(facts?.appDir).toBe("src");
  });

  it("returns null for a bare Solid SPA (no @solidjs/start)", async ({ dir }) => {
    expect(
      await new SolidStartDetector().detect(await project(dir, { "solid-js": "^1", vite: "^5" })),
    ).toBeNull();
  });

  it("returns null without a package.json", async ({ dir }) => {
    expect(await new SolidStartDetector().detect(dir)).toBeNull();
  });
});

describe("SolidStartDetector version floor", () => {
  it("refuses a SolidStart 1 app, which registers middleware where the patch cannot", async ({
    dir,
  }) => {
    await expect(
      new SolidStartDetector().detect(
        await project(dir, { "solid-js": "^1", "@solidjs/start": "^1.3.5" }),
      ),
    ).rejects.toMatchObject({
      code: "E_UNSUPPORTED_PROJECT_SHAPE",
    });
  });

  it("accepts a spec that may resolve to a supported version", async ({ dir }) => {
    expect(
      await new SolidStartDetector().detect(
        await project(dir, { "solid-js": "^1", "@solidjs/start": "latest", vite: "^8" }),
      ),
    ).not.toBeNull();
  });
});
