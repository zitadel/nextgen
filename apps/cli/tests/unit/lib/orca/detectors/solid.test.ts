import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SolidDetector } from "../../../../../src/lib/orca/detectors/solid";

const dirs: string[] = [];

async function project(deps: Record<string, string>): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "solid-detect-"));
  dirs.push(cwd);
  await writeFile(join(cwd, "package.json"), JSON.stringify({ dependencies: deps }));
  return cwd;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("SolidDetector", () => {
  it("recognises a Vite + Solid app and reports appDir 'src'", async () => {
    const facts = await new SolidDetector().detect(await project({ "solid-js": "^1", vite: "^5" }));
    expect(facts?.id).toBe("solid");
    expect(facts?.appDir).toBe("src");
  });

  it("excludes SolidStart (which ships Solid)", async () => {
    expect(
      await new SolidDetector().detect(
        await project({ "@solidjs/start": "^1", "solid-js": "^1", vite: "^5" }),
      ),
    ).toBeNull();
  });

  it("returns null without vite", async () => {
    expect(await new SolidDetector().detect(await project({ "solid-js": "^1" }))).toBeNull();
  });

  it("returns null without solid-js", async () => {
    expect(await new SolidDetector().detect(await project({ vite: "^5" }))).toBeNull();
  });
});
