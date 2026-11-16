import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import semver from "semver";
import { describe, expect } from "vitest";

import { detectors } from "@/lib/orca/detectors";
import { it } from "@tests/helpers/fixtures";

/** What a detector needs besides the package it floors before it recognises a project. */
const COMPANION_DEPENDENCIES: Record<string, Record<string, string>> = {
  "qwik-router": { "@qwik.dev/core": "^2.0.0-beta.45" },
  "solid-start": { "solid-js": "^1" },
  "tanstack-start": { react: "^19" },
};

/**
 * A project a detector would recognise, declaring `spec` for its framework package.
 *
 * @param cwd - The directory to write it in.
 * @param detector - The detector the project is for.
 * @param spec - The version range it declares for the detector's package.
 * @returns The directory.
 */
async function project(
  cwd: string,
  detector: (typeof detectors)[number],
  spec: string,
): Promise<string> {
  const dependencies: Record<string, string> = {
    ...COMPANION_DEPENDENCIES[detector.framework],
    [detector.versionPackage]: spec,
    vite: "^5",
  };
  await writeFile(join(cwd, "package.json"), JSON.stringify({ dependencies }));
  await mkdir(join(cwd, "app"));
  return cwd;
}

describe("detectors", () => {
  it.each(detectors.map((detector) => [detector.framework, detector] as const))(
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

  it.for(detectors)(
    "$framework enforces its declared floor when detecting",
    async (detector, { dir, other }) => {
      const floor = semver.coerce(detector.versionFloor);
      expect(floor).not.toBeNull();
      const below = `${(floor?.major ?? 1) - 1}.0.0`;

      await expect(detector.detect(await project(dir, detector, below))).rejects.toMatchObject({
        code: "E_UNSUPPORTED_PROJECT_SHAPE",
      });
      await expect(
        detector.detect(await project(other, detector, `^${detector.versionFloor}`)),
      ).resolves.toMatchObject({ id: detector.framework });
    },
  );

  // The CLI floor and the SDK peer range must not drift: a project the CLI
  // accepts has to be one the SDK installs on, and the reverse. The floor, read
  // as written (`2.0.0-beta.45`) or as the first release of its line (`18`),
  // must equal the peer's minimum, so a bare `2` cannot accept the earlier
  // betas that the peer range refuses.
  it.each(detectors.map((detector) => [detector.framework, detector] as const))(
    "%s floor equals the minimum its SDK peer range starts at",
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
