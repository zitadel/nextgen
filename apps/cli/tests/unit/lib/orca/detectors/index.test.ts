import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import semver from "semver";
import { afterEach, describe, expect, it } from "vitest";

import { detectors } from "../../../../../src/lib/orca/detectors";

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

/** A project a detector would recognise, declaring `spec` for its framework package. */
async function project(detector: (typeof detectors)[number], spec: string): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "detectors-index-"));
  dirs.push(cwd);
  const dependencies: Record<string, string> = { [detector.versionPackage]: spec, vite: "^5" };
  await writeFile(join(cwd, "package.json"), JSON.stringify({ dependencies }));
  await mkdir(join(cwd, "app"));
  return cwd;
}

describe("detectors", () => {
  it.each(detectors.map((detector) => [detector.framework, detector]))(
    "%s names itself and the package its version comes from",
    (_framework, detector) => {
      expect(detector.displayName.trim()).not.toBe("");
      expect(detector.versionPackage.trim()).not.toBe("");
    },
  );

  it("gives every framework its own id and display name", () => {
    const ids = detectors.map((detector) => detector.framework);
    const names = detectors.map((detector) => detector.displayName);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(detectors.map((detector) => [detector.framework, detector] as const))(
    "%s enforces its declared floor when detecting",
    async (_framework, detector) => {
      const floor =
        semver.valid(detector.versionFloor) ?? semver.coerce(detector.versionFloor)?.version;
      expect(peerMinimum).not.toBeNull();
      expect(floor).toBe(peerMinimum?.version);
      expect(semver.satisfies(floor as string, peer as string, { includePrerelease: true })).toBe(
        true,
      );
    },
  );
});
