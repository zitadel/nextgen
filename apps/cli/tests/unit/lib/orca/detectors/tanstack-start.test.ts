import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { TanStackStartDetector } from "../../../../../src/lib/orca/detectors/tanstack-start";

const dirs: string[] = [];

async function project(deps: Record<string, string>): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "tanstack-start-detect-"));
  dirs.push(cwd);
  await writeFile(join(cwd, "package.json"), JSON.stringify({ dependencies: deps }));
  return cwd;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("TanStackStartDetector", () => {
  it("recognises a TanStack Start app by react + @tanstack/react-start and reports appDir 'src'", async () => {
    const facts = await new TanStackStartDetector().detect(
      await project({ react: "^19", "@tanstack/react-start": "^1.168.10", vite: "^8" }),
    );
    expect(facts?.id).toBe("tanstack-start");
    expect(facts?.appDir).toBe("src");
  });

  it("returns null for a bare Vite + React SPA (no @tanstack/react-start)", async () => {
    expect(
      await new TanStackStartDetector().detect(await project({ react: "^19", vite: "^8" })),
    ).toBeNull();
  });

  it("returns null without a package.json", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "tanstack-start-empty-"));
    dirs.push(cwd);
    expect(await new TanStackStartDetector().detect(cwd)).toBeNull();
  });
});

describe("TanStackStartDetector version floor", () => {
  it("refuses a TanStack Start without createCsrfMiddleware, which the generated start.ts imports", async () => {
    await expect(
      new TanStackStartDetector().detect(
        await project({ react: "^19", "@tanstack/react-start": "1.168.9", vite: "^8" }),
      ),
    ).rejects.toMatchObject({
      code: "E_UNSUPPORTED_PROJECT_SHAPE",
    });
  });

  it("accepts a spec that may resolve to a supported version", async () => {
    expect(
      await new TanStackStartDetector().detect(
        await project({ react: "^19", "@tanstack/react-start": "^1.168.0", vite: "^8" }),
      ),
    ).not.toBeNull();
  });
});
