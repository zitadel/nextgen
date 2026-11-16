import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// @boundaries-ignore root scripts/ belongs to the workspace root, which no package can depend on
import { APP_RELEASE_PACKAGES, PUBLIC_PACKAGE_DIRS } from "../../../scripts/release-manifest.mjs";
import { test } from "./fixtures.mjs";
import { packageName } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const script = join(here, "verify-tarballs.mjs");

// The script resolves required package names from the repo manifests, so the
// fixture tarballs must carry the real names. Fabricate one minimal valid
// tarball per package: server platform packages additionally need their
// executable bin to satisfy assertServerPlatformBinary.
/**
 * The fabricated tarball sets, built once per file in a directory of their own and removed
 * when the file's tests are done.
 */
const it = test.extend({
  sets: [
    // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
    async ({}, use) => {
      const fixtureRoot = await mkdtemp(join(tmpdir(), "verify-tarballs-test-"));
      const sets = {
        fixtureRoot,
        releaseSetDir: join(fixtureRoot, "release-set"),
        independentVersionsDir: join(fixtureRoot, "independent-versions"),
        invalidVersionDir: join(fixtureRoot, "invalid-version"),
        nonExecutableBinaryDir: join(fixtureRoot, "non-executable-binary"),
        extraPackageDir: join(fixtureRoot, "extra-package"),
        missingPackageDir: join(fixtureRoot, "missing-package"),
        cliMissingSkillDir: join(fixtureRoot, "cli-missing-skill"),
      };
      await mkdir(sets.releaseSetDir, { recursive: true });

      for (const dir of PUBLIC_PACKAGE_DIRS) {
        await makeTarball(fixtureRoot, sets.releaseSetDir, await packageName(repoRoot, dir));
      }
      // Each variant is the release set with one package's tarball replaced.
      await cp(sets.releaseSetDir, sets.independentVersionsDir, { recursive: true });
      await makeTarball(fixtureRoot, sets.independentVersionsDir, "@zitadel/components", {
        version: "0.2.0-alpha.1",
      });
      await makeTarball(fixtureRoot, sets.independentVersionsDir, "@zitadel/sdk-next", {
        version: "0.1.0-alpha.4",
      });
      await cp(sets.releaseSetDir, sets.invalidVersionDir, { recursive: true });
      await makeTarball(fixtureRoot, sets.invalidVersionDir, "@zitadel/sdk-next", {
        version: "workspace:*",
      });
      await cp(sets.releaseSetDir, sets.nonExecutableBinaryDir, { recursive: true });
      await makeTarball(fixtureRoot, sets.nonExecutableBinaryDir, "@zitadel/server-darwin-arm64", {
        executable: false,
      });
      await cp(sets.releaseSetDir, sets.extraPackageDir, { recursive: true });
      await makeTarball(fixtureRoot, sets.extraPackageDir, "@zitadel/api-mock");
      await cp(sets.releaseSetDir, sets.missingPackageDir, { recursive: true });
      await rm(join(sets.missingPackageDir, "zitadel-testing.tgz"));
      await cp(sets.releaseSetDir, sets.cliMissingSkillDir, { recursive: true });
      await makeTarball(fixtureRoot, sets.cliMissingSkillDir, "@zitadel/cli", {
        omitCliSkill: true,
      });
      await use(sets);
      await rm(fixtureRoot, { recursive: true, force: true });
    },
    { scope: "file" },
  ],
});

it("accepts exactly the public release set", ({ sets: { releaseSetDir } }) => {
  const strict = runVerify(releaseSetDir);
  assert.equal(strict.status, 0, strict.stderr);
  assert.match(strict.stdout, /verified \d+ installable tarballs/);
});

it("accepts packages whose versions differ from each other", ({
  sets: { independentVersionsDir },
}) => {
  const result = runVerify(independentVersionsDir);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /verified \d+ installable tarballs/);
});

it("rejects a public tarball whose version is not semver", ({ sets: { invalidVersionDir } }) => {
  const result = runVerify(invalidVersionDir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /public package tarballs must use semver versions/);
});

it("rejects a server platform tarball whose binary is not executable", ({
  sets: { nonExecutableBinaryDir },
}) => {
  const result = runVerify(nonExecutableBinaryDir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /contains non-executable bin\/nextgen/);
});

it("rejects tarballs outside the release set as unexpected", ({ sets: { extraPackageDir } }) => {
  const result = runVerify(extraPackageDir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unexpected package @zitadel\/api-mock/);
});

it("rejects a set missing a public release package", ({ sets: { missingPackageDir } }) => {
  const result = runVerify(missingPackageDir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing tarball for @zitadel\/testing/);
});

it("rejects a @zitadel/cli tarball missing the agent skill bundle", ({
  sets: { cliMissingSkillDir },
}) => {
  const result = runVerify(cliMissingSkillDir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing CLI agent skill files/);
});

it("--app-packages accepts exactly what a generated app installs", async ({
  sets: { releaseSetDir },
  dir,
}) => {
  const appSetDir = join(dir, "app-set");
  await mkdir(appSetDir, { recursive: true });
  for (const pkg of APP_RELEASE_PACKAGES) {
    await makeTarball(dir, appSetDir, pkg.name);
  }

  const result = runVerify(appSetDir, "--app-packages");
  assert.equal(result.status, 0, result.stderr);
  // Without the flag the CLI and server tarballs are missing.
  assert.match(runVerify(appSetDir).stderr, /missing tarball for @zitadel\/cli/);
  // The release set carries packages a generated app never installs.
  assert.match(
    runVerify(releaseSetDir, "--app-packages").stderr,
    /unexpected package @zitadel\/(cli|server)/,
  );
});

it("--packages accepts exactly a journey's own set", async ({ dir }) => {
  const dirs = ["apps/cli", "packages/sdk-svelte"];
  const journeySetDir = join(dir, "journey-set");
  await mkdir(journeySetDir, { recursive: true });
  for (const packageDir of dirs) {
    await makeTarball(dir, journeySetDir, await packageName(repoRoot, packageDir));
  }

  const flag = `--packages=${dirs.join(",")}`;
  assert.equal(runVerify(journeySetDir, flag).status, 0);
  assert.match(
    runVerify(journeySetDir, "--packages=apps/cli").stderr,
    /unexpected package @zitadel\/sdk-svelte/,
  );
  assert.match(
    runVerify(journeySetDir, `${flag},packages/sdk-vue`).stderr,
    /missing tarball for @zitadel\/sdk-vue/,
  );
});

it("unknown flags are rejected", ({ sets: { releaseSetDir } }) => {
  const result = runVerify(releaseSetDir, "--bogus");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown flags: --bogus/);
});

function runVerify(dir, ...flags) {
  return spawnSync("node", [script, dir, ...flags], { encoding: "utf8" });
}

/**
 * Writes `<outDir>/<package>.tgz`, replacing the package's tarball when the
 * directory already has one.
 */
async function makeTarball(
  stageRoot,
  outDir,
  name,
  { omitCliSkill = false, version = "1.0.0", executable = true } = {},
) {
  const safe = name.replace(/[@/]/g, "-").replace(/^-/, "");
  const stage = join(stageRoot, "stage", safe);
  const packageDir = join(stage, "package");
  await rm(stage, { recursive: true, force: true });
  await mkdir(packageDir, { recursive: true });
  const manifest = { name, version };
  if (/^@zitadel\/server-(?:darwin|linux|win32)-/.test(name)) {
    const bin = name.includes("win32") ? "bin/nextgen.exe" : "bin/nextgen";
    manifest.bin = { nextgen: `./${bin}` };
    await mkdir(join(packageDir, "bin"), { recursive: true });
    await writeFile(join(packageDir, bin), "#!/bin/sh\n", { mode: executable ? 0o755 : 0o644 });
  }
  if (name === "@zitadel/cli" && !omitCliSkill) {
    await cp(join(repoRoot, "apps/cli/skills"), join(packageDir, "skills"), { recursive: true });
    await cp(join(repoRoot, "apps/cli/skills"), join(packageDir, "dist/skills"), {
      recursive: true,
    });
    await cp(join(repoRoot, "skills/zitadel"), join(packageDir, "dist/skills/zitadel"), {
      recursive: true,
    });
  }
  await writeFile(join(packageDir, "package.json"), JSON.stringify(manifest));
  const tar = spawnSync("tar", ["-czf", join(outDir, `${safe}.tgz`), "-C", stage, "package"], {
    encoding: "utf8",
  });
  assert.equal(tar.status, 0, tar.stderr);
}
