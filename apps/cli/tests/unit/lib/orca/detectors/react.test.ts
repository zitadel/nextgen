import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { ReactDetector } from "@/lib/orca/detectors/react";
import { ZitadelError } from "@/lib/errors";
import { it } from "@tests/fixtures";
import { rejectionOf } from "@tests/helpers/thrown-value";

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

describe("ReactDetector", () => {
  it("recognises a Vite + React app and reports appDir 'src'", async ({ dir }) => {
    const facts = await new ReactDetector().detect(
      await project(dir, { react: "^18", vite: "^5" }),
    );
    expect(facts?.id).toBe("react");
    expect(facts?.appDir).toBe("src");
  });

  it("excludes Next.js (which ships React) so NextDetector wins", async ({ dir }) => {
    expect(
      await new ReactDetector().detect(
        await project(dir, { next: "^14", react: "^18", vite: "^5" }),
      ),
    ).toBeNull();
  });

  it("returns null without vite", async ({ dir }) => {
    expect(await new ReactDetector().detect(await project(dir, { react: "^18" }))).toBeNull();
  });

  it("returns null without react", async ({ dir }) => {
    expect(await new ReactDetector().detect(await project(dir, { vite: "^5" }))).toBeNull();
  });

  it("captures the React major version", async ({ dir }) => {
    const facts = await new ReactDetector().detect(
      await project(dir, { react: "^19.1.0", vite: "^5" }),
    );
    expect(facts?.versionMajor).toBe(19);
  });

  it("throws the version floor for React 17", async ({ dir }) => {
    const caught = await rejectionOf(async () =>
      new ReactDetector().detect(await project(dir, { react: "^17.0.2", vite: "^5" })),
    );
    expect(caught).toBeInstanceOf(ZitadelError);
    expect((caught as ZitadelError).code).toBe("E_UNSUPPORTED_PROJECT_SHAPE");
    expect((caught as ZitadelError).message).toContain("below the supported floor");
  });

  it("lets an unparseable react version through the floor", async ({ dir }) => {
    // "latest" carries no provable major; blocking on it would be hostile.
    const facts = await new ReactDetector().detect(
      await project(dir, { react: "latest", vite: "^5" }),
    );
    expect(facts?.id).toBe("react");
    expect(facts).not.toHaveProperty("versionMajor");
  });

  it("accepts a pinned React 19 prerelease against the React 18 floor", async ({ dir }) => {
    const facts = await new ReactDetector().detect(
      await project(dir, { react: "19.0.0-rc.1", vite: "^5" }),
    );
    expect(facts?.id).toBe("react");
  });

  it("judges the floor by range semantics, not by digits in the spec", async ({ dir }) => {
    // "<18" contains the digits 18 yet admits only versions below the floor.
    await expect(
      new ReactDetector().detect(await project(dir, { react: "<18", vite: "^5" })),
    ).rejects.toThrow("below the supported floor");
    // A path spec carries digits but no provable version — it must pass.
    const patched = await new ReactDetector().detect(
      await project(dir, { react: "file:../react-17-patched", vite: "^5" }),
    );
    expect(patched?.id).toBe("react");
  });
});
