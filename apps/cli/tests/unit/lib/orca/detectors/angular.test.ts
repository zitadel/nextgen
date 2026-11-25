import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { AngularDetector } from "@/lib/orca/detectors/angular";
import { it } from "@tests/fixtures";

/**
 * Writes a `package.json` with the given dependencies into a directory.
 *
 * @param cwd - The directory to write it in.
 * @param deps - The dependencies it declares.
 * @returns The directory, for the detector to look at.
 */
async function project(cwd: string, deps: Record<string, string>): Promise<string> {
  await writeFile(join(cwd, "package.json"), JSON.stringify({ dependencies: deps }));
  return cwd;
}

describe("AngularDetector", () => {
  it("recognises an Angular app and reports appDir 'src/app'", async ({ dir }) => {
    const facts = await new AngularDetector().detect(
      await project(dir, { "@angular/core": "^18" }),
    );
    expect(facts?.id).toBe("angular");
    expect(facts?.appDir).toBe("src/app");
  });

  it("returns null without @angular/core", async ({ dir }) => {
    expect(await new AngularDetector().detect(await project(dir, { react: "^18" }))).toBeNull();
  });

  it("refuses Angular older than 17 (templates use @if)", async ({ dir }) => {
    await expect(
      new AngularDetector().detect(await project(dir, { "@angular/core": "^16.2.0" })),
    ).rejects.toMatchObject({
      category: "unsupported",
      message: expect.stringContaining("Angular 17 and newer"),
    });
  });

  it("still detects when the version range has no parseable major", async ({ dir }) => {
    const facts = await new AngularDetector().detect(
      await project(dir, { "@angular/core": "latest" }),
    );
    expect(facts?.id).toBe("angular");
  });
});
