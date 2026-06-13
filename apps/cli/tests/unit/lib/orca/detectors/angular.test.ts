import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AngularDetector } from "../../../../../src/lib/orca/detectors/angular";

const dirs: string[] = [];

async function project(deps: Record<string, string>): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "angular-detect-"));
  dirs.push(cwd);
  await writeFile(join(cwd, "package.json"), JSON.stringify({ dependencies: deps }));
  return cwd;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("AngularDetector", () => {
  it("recognises an Angular app and reports appDir 'src/app'", async () => {
    const facts = await new AngularDetector().detect(await project({ "@angular/core": "^18" }));
    expect(facts?.id).toBe("angular");
    expect(facts?.appDir).toBe("src/app");
  });

  it("returns null without @angular/core", async () => {
    expect(await new AngularDetector().detect(await project({ react: "^18" }))).toBeNull();
  });

  it("throws E_VALIDATION on Angular older than 17 (templates use @if)", async () => {
    await expect(
      new AngularDetector().detect(await project({ "@angular/core": "^16.2.0" })),
    ).rejects.toThrowError(/Angular 16 is unsupported/);
  });

  it("still detects when the version range has no parseable major", async () => {
    const facts = await new AngularDetector().detect(await project({ "@angular/core": "latest" }));
    expect(facts?.id).toBe("angular");
  });
});
