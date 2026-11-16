import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { it } from "@tests/helpers/fixtures";
import { TanStackStartDetector } from "@/lib/orca/detectors/tanstack-start";

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

describe("TanStackStartDetector", () => {
  it("recognises a TanStack Start app by react + @tanstack/react-start and reports appDir 'src'", async ({
    dir,
  }) => {
    const facts = await new TanStackStartDetector().detect(
      await project(dir, { react: "^19", "@tanstack/react-start": "^1.168.10", vite: "^8" }),
    );
    expect(facts?.id).toBe("tanstack-start");
    expect(facts?.appDir).toBe("src");
  });

  it("returns null for a bare Vite + React SPA (no @tanstack/react-start)", async ({ dir }) => {
    expect(
      await new TanStackStartDetector().detect(await project(dir, { react: "^19", vite: "^8" })),
    ).toBeNull();
  });

  it("returns null without a package.json", async ({ dir }) => {
    expect(await new TanStackStartDetector().detect(dir)).toBeNull();
  });
});

describe("TanStackStartDetector version floor", () => {
  it("refuses a TanStack Start without createCsrfMiddleware, which the generated start.ts imports", async ({
    dir,
  }) => {
    await expect(
      new TanStackStartDetector().detect(
        await project(dir, { react: "^19", "@tanstack/react-start": "1.168.9", vite: "^8" }),
      ),
    ).rejects.toMatchObject({
      code: "E_UNSUPPORTED_PROJECT_SHAPE",
    });
  });

  it("accepts a spec that may resolve to a supported version", async ({ dir }) => {
    expect(
      await new TanStackStartDetector().detect(
        await project(dir, { react: "^19", "@tanstack/react-start": "^1.168.0", vite: "^8" }),
      ),
    ).not.toBeNull();
  });
});
