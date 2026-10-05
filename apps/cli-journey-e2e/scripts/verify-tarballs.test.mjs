/* oxlint-disable playwright/expect-expect -- Vitest file asserting via node:assert */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, test } from "vitest";

import { PUBLIC_PACKAGE_DIRS } from "../../../scripts/release-manifest.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const script = join(here, "verify-tarballs.mjs");

// The script resolves required package names from the repo manifests, so the
// fixture tarballs must carry the real names. Fabricate one minimal valid
// tarball per package: server platform packages additionally need their
// executable bin to satisfy assertServerPlatformBinary.
let fixtureRoot;
let releaseSetDir;
let extraPackageDir;
let missingPackageDir;
let cliMissingSkillDir;

beforeAll(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), "verify-tarballs-test-"));
  releaseSetDir = join(fixtureRoot, "release-set");
  extraPackageDir = join(fixtureRoot, "extra-package");
  missingPackageDir = join(fixtureRoot, "missing-package");
  cliMissingSkillDir = join(fixtureRoot, "cli-missing-skill");
  await mkdir(releaseSetDir, { recursive: true });

  for (const dir of PUBLIC_PACKAGE_DIRS) {
    await makeTarball(releaseSetDir, await packageName(dir));
  }
  await cp(releaseSetDir, extraPackageDir, { recursive: true });
  await makeTarball(extraPackageDir, "@zitadel/api-mock");
  await cp(releaseSetDir, missingPackageDir, { recursive: true });
  await rm(join(missingPackageDir, "zitadel-testing-1.0.0.tgz"));
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

async function packageName(dir) {
  const manifest = JSON.parse(await readFile(join(repoRoot, dir, "package.json"), "utf8"));
  return manifest.name;
}

async function makeTarball(outDir, name, { omitCliSkill = false } = {}) {
  const safe = name.replace(/[@/]/g, "-").replace(/^-/, "");
  const stage = join(fixtureRoot, "stage", safe);
  const packageDir = join(stage, "package");
  await rm(stage, { recursive: true, force: true });
  await mkdir(packageDir, { recursive: true });
  const manifest = { name, version: "1.0.0" };
  if (/^@zitadel\/server-(?:darwin|linux|win32)-/.test(name)) {
    const bin = name.includes("win32") ? "bin/nextgen.exe" : "bin/nextgen";
    manifest.bin = { nextgen: `./${bin}` };
    await mkdir(join(packageDir, "bin"), { recursive: true });
    await writeFile(join(packageDir, bin), "#!/bin/sh\n", { mode: 0o755 });
  }
  if (name === "@zitadel/cli" && !omitCliSkill) {
    await cp(join(repoRoot, "apps/cli/skills"), join(packageDir, "skills"), { recursive: true });
  }
  await writeFile(join(packageDir, "package.json"), JSON.stringify(manifest));
  const tar = spawnSync(
    "tar",
    ["-czf", join(outDir, `${safe}-1.0.0.tgz`), "-C", stage, "package"],
    {
      encoding: "utf8",
    },
  );
  assert.equal(tar.status, 0, tar.stderr);
}
