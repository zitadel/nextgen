/* oxlint-disable playwright/expect-expect -- node:test file asserting via node:assert */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

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

before(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), "verify-tarballs-test-"));
  releaseSetDir = join(fixtureRoot, "release-set");
  extraPackageDir = join(fixtureRoot, "extra-package");
  missingPackageDir = join(fixtureRoot, "missing-package");
  await mkdir(releaseSetDir, { recursive: true });

  for (const dir of PUBLIC_PACKAGE_DIRS) {
    await makeTarball(releaseSetDir, await packageName(dir));
  }
  await cp(releaseSetDir, extraPackageDir, { recursive: true });
  await makeTarball(extraPackageDir, "@zitadel/api-mock");
  await cp(releaseSetDir, missingPackageDir, { recursive: true });
  await rm(join(missingPackageDir, "zitadel-testing-1.0.0.tgz"));
});

after(async () => {
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

async function makeTarball(outDir, name) {
  const safe = name.replace(/[@/]/g, "-").replace(/^-/, "");
  const stage = join(fixtureRoot, "stage", safe);
  const packageDir = join(stage, "package");
  await mkdir(packageDir, { recursive: true });
  const manifest = { name, version: "1.0.0" };
  if (/^@zitadel\/server-(?:darwin|linux|win32)-/.test(name)) {
    const bin = name.includes("win32") ? "bin/nextgen.exe" : "bin/nextgen";
    manifest.bin = { nextgen: `./${bin}` };
    await mkdir(join(packageDir, "bin"), { recursive: true });
    await writeFile(join(packageDir, bin), "#!/bin/sh\n", { mode: 0o755 });
  }
  await writeFile(join(packageDir, "package.json"), JSON.stringify(manifest));
  const tar = spawnSync("tar", ["-czf", join(outDir, `${safe}-1.0.0.tgz`), "-C", stage, "package"], {
    encoding: "utf8",
  });
  assert.equal(tar.status, 0, tar.stderr);
}
