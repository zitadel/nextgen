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
      const floor = semver.coerce(detector.versionFloor);
      expect(floor).not.toBeNull();
      const below = `${(floor?.major ?? 1) - 1}.0.0`;

      await expect(detector.detect(await project(detector, below))).rejects.toMatchObject({
        code: "E_UNSUPPORTED_PROJECT_SHAPE",
      });
      await expect(
        detector.detect(await project(detector, `^${detector.versionFloor}`)),
      ).resolves.toMatchObject({ id: detector.framework });
    },
  );

  // The CLI floor and the SDK peer range must not drift: a project the CLI
  // accepts has to be one the SDK installs on, and the reverse. Next's floor is
  // a patch release above the peer minimum (the CVE-2025-29927 fix), so only
  // the major must match there; the floor must still satisfy the peer range.
  it.each(detectors.map((detector) => [detector.framework, detector] as const))(
    "%s floor matches the major its SDK peer range starts at",
    async (framework, detector) => {
      const manifest = JSON.parse(
        await readFile(
          resolve(
            import.meta.dirname,
            `../../../../../../../packages/sdk-${framework}/package.json`,
          ),
          "utf8",
        ),
      ) as { peerDependencies?: Record<string, string> };
      const peer = manifest.peerDependencies?.[detector.versionPackage];

      expect(peer).toBeDefined();
      const peerMinimum = semver.minVersion(peer as string);
      const floor = semver.coerce(detector.versionFloor);
      expect(peerMinimum).not.toBeNull();
      expect(floor?.major).toBe(peerMinimum?.major);
      expect(
        semver.satisfies(floor?.version as string, peer as string, { includePrerelease: true }),
      ).toBe(true);
    },
  );
});
