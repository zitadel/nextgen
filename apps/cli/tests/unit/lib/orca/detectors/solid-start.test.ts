import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SolidStartDetector } from "../../../../../src/lib/orca/detectors/solid-start";

const dirs: string[] = [];

async function project(deps: Record<string, string>): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "solid-start-detect-"));
  dirs.push(cwd);
  await writeFile(join(cwd, "package.json"), JSON.stringify({ dependencies: deps }));
  return cwd;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("SolidStartDetector", () => {
  it("recognises a SolidStart app by solid-js + @solidjs/start and reports appDir 'src'", async () => {
    const facts = await new SolidStartDetector().detect(
      await project({ "solid-js": "^1", "@solidjs/start": "^2", vite: "^8" }),
    );
    expect(facts?.id).toBe("solid-start");
    expect(facts?.appDir).toBe("src");
  });

  it("returns null for a bare Solid SPA (no @solidjs/start)", async () => {
    expect(
      await new SolidStartDetector().detect(await project({ "solid-js": "^1", vite: "^5" })),
    ).toBeNull();
  });

  it("returns null without a package.json", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "solid-start-empty-"));
    dirs.push(cwd);
    expect(await new SolidStartDetector().detect(cwd)).toBeNull();
  });
});

describe("SolidStartDetector version floor", () => {
  it("refuses a SolidStart 1 app, which registers middleware where the patch cannot", async () => {
    await expect(
      new SolidStartDetector().detect(
        await project({ "solid-js": "^1", "@solidjs/start": "^1.3.5" }),
      ),
    ).rejects.toMatchObject({
      code: "E_UNSUPPORTED_PROJECT_SHAPE",
    });
  });

  it("accepts a spec that may resolve to a supported version", async () => {
    expect(
      await new SolidStartDetector().detect(
        await project({ "solid-js": "^1", "@solidjs/start": "latest", vite: "^8" }),
      ),
    ).not.toBeNull();
  });
});

describe("SolidStartDetector solid-js floor", () => {
  it("refuses a solid-js the widgets cannot run on", async () => {
    await expect(
      new SolidStartDetector().detect(
        await project({ "solid-js": "~1.7.0", "@solidjs/start": "^2", vite: "^8" }),
      ),
    ).rejects.toMatchObject({ code: "E_UNSUPPORTED_PROJECT_SHAPE" });
  });
});
