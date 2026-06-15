import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ReactDetector } from "../../../../../src/lib/orca/detectors/react";

const dirs: string[] = [];

async function project(deps: Record<string, string>): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "react-detect-"));
  dirs.push(cwd);
  await writeFile(join(cwd, "package.json"), JSON.stringify({ dependencies: deps }));
  return cwd;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("ReactDetector", () => {
  it("recognises a Vite + React app and reports appDir 'src'", async () => {
    const facts = await new ReactDetector().detect(await project({ react: "^18", vite: "^5" }));
    expect(facts?.id).toBe("react");
    expect(facts?.appDir).toBe("src");
  });

  it("excludes Next.js (which ships React) so NextDetector wins", async () => {
    expect(
      await new ReactDetector().detect(await project({ next: "^14", react: "^18", vite: "^5" })),
    ).toBeNull();
  });

  it("returns null without vite", async () => {
    expect(await new ReactDetector().detect(await project({ react: "^18" }))).toBeNull();
  });

  it("returns null without react", async () => {
    expect(await new ReactDetector().detect(await project({ vite: "^5" }))).toBeNull();
  });
});
