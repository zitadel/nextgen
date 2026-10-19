import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, test } from "vitest";

import { PUBLIC_PACKAGE_DIRS } from "../../../scripts/release-manifest.mjs";
import { packageName } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const script = join(here, "verify-tarballs.mjs");

// The script resolves required package names from the repo manifests, so the
// fixture tarballs must carry the real names. Fabricate one minimal valid
// tarball per package: server platform packages additionally need their
// executable bin to satisfy assertServerPlatformBinary.
let fixtureRoot;
let releaseSetDir;
let independentVersionsDir;
let invalidVersionDir;
let nonExecutableBinaryDir;
let extraPackageDir;
let missingPackageDir;
let cliMissingSkillDir;

beforeAll(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), "verify-tarballs-test-"));
  releaseSetDir = join(fixtureRoot, "release-set");
  independentVersionsDir = join(fixtureRoot, "independent-versions");
  invalidVersionDir = join(fixtureRoot, "invalid-version");
  nonExecutableBinaryDir = join(fixtureRoot, "non-executable-binary");
  extraPackageDir = join(fixtureRoot, "extra-package");
  missingPackageDir = join(fixtureRoot, "missing-package");
  cliMissingSkillDir = join(fixtureRoot, "cli-missing-skill");
  await mkdir(releaseSetDir, { recursive: true });

  for (const dir of PUBLIC_PACKAGE_DIRS) {
    await makeTarball(releaseSetDir, await packageName(repoRoot, dir));
  }
  // Each variant is the release set with one package's tarball replaced.
  await cp(releaseSetDir, independentVersionsDir, { recursive: true });
  await makeTarball(independentVersionsDir, "@zitadel/components", { version: "0.2.0-alpha.1" });
  await makeTarball(independentVersionsDir, "@zitadel/sdk-next", { version: "0.1.0-alpha.4" });
  await cp(releaseSetDir, invalidVersionDir, { recursive: true });
  await makeTarball(invalidVersionDir, "@zitadel/sdk-next", { version: "workspace:*" });
  await cp(releaseSetDir, nonExecutableBinaryDir, { recursive: true });
  await makeTarball(nonExecutableBinaryDir, "@zitadel/server-darwin-arm64", { executable: false });
  await cp(releaseSetDir, extraPackageDir, { recursive: true });
  await makeTarball(extraPackageDir, "@zitadel/api-mock");
  await cp(releaseSetDir, missingPackageDir, { recursive: true });
  await rm(join(missingPackageDir, "zitadel-testing.tgz"));
  await cp(releaseSetDir, cliMissingSkillDir, { recursive: true });
  await makeTarball(cliMissingSkillDir, "@zitadel/cli", { omitCliSkill: true });
});

afterAll(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

test("accepts exactly the public release set", () => {
  const strict = runVerify(releaseSetDir);
  assert.equal(strict.status, 0, strict.stderr);
  assert.match(strict.stdout, /verified \d+ installable tarballs/);
});

test("accepts packages whose versions differ from each other", () => {
  const result = runVerify(independentVersionsDir);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /verified \d+ installable tarballs/);
});

test("rejects a public tarball whose version is not semver", () => {
  const result = runVerify(invalidVersionDir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /public package tarballs must use semver versions/);
});

test("rejects a server platform tarball whose binary is not executable", () => {
  const result = runVerify(nonExecutableBinaryDir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /contains non-executable bin\/nextgen/);
});

test("rejects tarballs outside the release set as unexpected", () => {
  const result = runVerify(extraPackageDir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unexpected package @zitadel\/api-mock/);
});

test("rejects a set missing a public release package", () => {
  const result = runVerify(missingPackageDir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing tarball for @zitadel\/testing/);
});

test("rejects a @zitadel/cli tarball missing the agent skill bundle", () => {
  const result = runVerify(cliMissingSkillDir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing CLI agent skill files/);
});

test("unknown flags are rejected", () => {
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
  outDir,
  name,
  { omitCliSkill = false, version = "1.0.0", executable = true } = {},
) {
  const safe = name.replace(/[@/]/g, "-").replace(/^-/, "");
  const stage = join(fixtureRoot, "stage", safe);
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
  }
  await writeFile(join(packageDir, "package.json"), JSON.stringify(manifest));
  const tar = spawnSync("tar", ["-czf", join(outDir, `${safe}.tgz`), "-C", stage, "package"], {
    encoding: "utf8",
  });
  assert.equal(tar.status, 0, tar.stderr);
}
