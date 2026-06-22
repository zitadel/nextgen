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
      await project({ "solid-js": "^1", "@solidjs/start": "^1", vinxi: "^0" }),
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
