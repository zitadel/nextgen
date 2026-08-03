import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ReactDetector } from "../../../../../src/lib/orca/detectors/react";
import { ZitadelError } from "../../../../../src/lib/errors";

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

  it("captures the React major version", async () => {
    const facts = await new ReactDetector().detect(await project({ react: "^19.1.0", vite: "^5" }));
    expect(facts?.versionMajor).toBe(19);
  });

  it("throws the version floor for React 17", async () => {
    let caught: unknown;
    try {
      await new ReactDetector().detect(await project({ react: "^17.0.2", vite: "^5" }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ZitadelError);
    expect((caught as ZitadelError).code).toBe("E_UNSUPPORTED_PROJECT_SHAPE");
    expect((caught as ZitadelError).message).toContain("below the supported floor");
  });

  it("lets an unparseable react version through the floor", async () => {
    // "latest" carries no provable major; blocking on it would be hostile.
    const facts = await new ReactDetector().detect(await project({ react: "latest", vite: "^5" }));
    expect(facts?.id).toBe("react");
    expect(facts).not.toHaveProperty("versionMajor");
  });

  it("judges the floor by range semantics, not by digits in the spec", async () => {
    // "<18" contains the digits 18 yet admits only versions below the floor.
    await expect(
      new ReactDetector().detect(await project({ react: "<18", vite: "^5" })),
    ).rejects.toThrow("below the supported floor");
    // A path spec carries digits but no provable version — it must pass.
    const patched = await new ReactDetector().detect(
      await project({ react: "file:../react-17-patched", vite: "^5" }),
    );
    expect(patched?.id).toBe("react");
  });
});
