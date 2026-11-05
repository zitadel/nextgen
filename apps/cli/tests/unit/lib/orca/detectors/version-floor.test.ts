import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import semver from "semver";
import { afterEach, describe, expect, it } from "vitest";

import { ZitadelError } from "../../../../../src/lib/errors";
import { detectors } from "../../../../../src/lib/orca/detectors";
import { enforceVersionFloor } from "../../../../../src/lib/orca/detectors/version-floor";

const dirs: string[] = [];

async function emptyDir(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "version-floor-"));
  dirs.push(cwd);
  return cwd;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

/** Versions around a detector's floor, derived from the floor it declares. */
function around(floor: string) {
  if ((semver.prerelease(floor)?.length ?? 0) > 0) {
    // A prerelease floor is the bound as written: `-0` sorts below any named prerelease.
    const base = semver.coerce(floor)?.version as string;
    return {
      below: `${base}-0`,
      at: floor,
      above: `${semver.major(floor) + 1}.0.0`,
      prerelease: `${base}-rc.0`,
    };
  }
  const at = semver.coerce(floor);
  if (!at) {
    throw new Error(`unparseable floor ${floor}`);
  }
  const below =
    at.patch > 0
      ? `${at.major}.${at.minor}.${at.patch - 1}`
      : at.minor > 0
        ? `${at.major}.${at.minor - 1}.0`
        : `${at.major - 1}.0.0`;
  return {
    below,
    at: at.version,
    above: `${at.major + 1}.0.0`,
    prerelease: `${at.version}-rc.0`,
  };
}

async function refusal(promise: Promise<unknown>): Promise<ZitadelError> {
  const caught = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(caught).toBeInstanceOf(ZitadelError);
  return caught as ZitadelError;
}

describe.each(detectors.map((detector) => [detector.framework, detector] as const))(
  "enforceVersionFloor for %s",
  (_framework, detector) => {
    const { below, at, above, prerelease } = around(detector.versionFloor);
    const check = async (spec: string) =>
      enforceVersionFloor(
        detector,
        { dependencies: { [detector.versionPackage]: spec } },
        await emptyDir(),
      );

    it("refuses a version below the floor, naming the floor and an upgrade", async () => {
      const error = await refusal(check(below));
      expect(error.code).toBe("E_UNSUPPORTED_PROJECT_SHAPE");
      expect(error.message).toContain(
        `${detector.displayName} "${below}" is below the supported floor`,
      );
      expect(error.message).toContain(`${detector.displayName} ${detector.versionFloor} and newer`);
      expect(error.hint).toContain(
        `Upgrade the app to ${detector.displayName} ${detector.versionFloor} or later`,
      );
    });

    it("refuses a range that stays below the floor", async () => {
      expect((await refusal(check(`<${detector.versionFloor}`))).code).toBe(
        "E_UNSUPPORTED_PROJECT_SHAPE",
      );
    });

    it("refuses a below-floor version declared in devDependencies", async () => {
      const error = await refusal(
        enforceVersionFloor(
          detector,
          { devDependencies: { [detector.versionPackage]: below } },
          await emptyDir(),
        ),
      );
      expect(error.code).toBe("E_UNSUPPORTED_PROJECT_SHAPE");
    });

    it.each([
      ["the floor", at],
      ["a newer major", above],
      ["a range spanning the floor", `>=${below}`],
      ["a workspace protocol", "workspace:*"],
      ["a path protocol", `file:../${detector.versionPackage}-${below}`],
      ["a git URL", `github:org/repo#${below}`],
      ["a dist-tag", "latest"],
    ])("accepts %s", async (_label, spec) => {
      await expect(check(spec)).resolves.toBeUndefined();
    });

    // A floor naming only a line (React 18) takes a prerelease of it as at-floor; an
    // exact release floor (Next.js 15.2.3) does not, since the prerelease predates it.
    const exactRelease = semver.valid(detector.versionFloor) !== null;
    const prereleaseFloor = (semver.prerelease(detector.versionFloor)?.length ?? 0) > 0;
    if (exactRelease && !prereleaseFloor) {
      it("refuses a prerelease of the exact release floor", async () => {
        expect((await refusal(check(prerelease))).code).toBe("E_UNSUPPORTED_PROJECT_SHAPE");
      });
    } else {
      it("accepts a prerelease of the floor", async () => {
        await expect(check(prerelease)).resolves.toBeUndefined();
      });
    }

    it("accepts a project that does not declare the package", async () => {
      await expect(enforceVersionFloor(detector, {}, await emptyDir())).resolves.toBeUndefined();
    });

    describe("what is installed", () => {
      async function installed(version: string): Promise<string> {
        const cwd = await emptyDir();
        const dir = join(cwd, "node_modules", detector.versionPackage);
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, "package.json"), JSON.stringify({ version }));
        return cwd;
      }

      it("refuses an installed release below the floor under an accepting range", async () => {
        const error = await refusal(
          enforceVersionFloor(
            detector,
            { dependencies: { [detector.versionPackage]: `>=${below}` } },
            await installed(below),
          ),
        );
        expect(error.code).toBe("E_UNSUPPORTED_PROJECT_SHAPE");
        expect(error.message).toContain(`${detector.displayName} ${below} is installed`);
      });

      it("accepts an installed release at the floor", async () => {
        for (const version of exactRelease && !prereleaseFloor ? [at] : [at, prerelease]) {
          await expect(
            enforceVersionFloor(
              detector,
              { dependencies: { [detector.versionPackage]: `>=${below}` } },
              await installed(version),
            ),
          ).resolves.toBeUndefined();
        }
      });
    });
  },
);

describe("enforceVersionFloor note", () => {
  it("appends the detector's note to the upgrade hint", async () => {
    const error = await refusal(
      enforceVersionFloor(
        {
          displayName: "Fake",
          versionPackage: "fake",
          versionFloor: "2",
          versionFloorNote: "Older releases are insecure.",
        },
        { dependencies: { fake: "1.0.0" } },
        await emptyDir(),
      ),
    );
    expect(error.hint).toBe(
      "Upgrade the app to Fake 2 or later and rerun. Older releases are insecure.",
    );
  });
});
