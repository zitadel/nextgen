import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { PUBLIC_PACKAGE_DIRS } from "../../../scripts/release-manifest.mjs";

const [tarballsDir, ...flags] = process.argv.slice(2);
if (!tarballsDir || tarballsDir.startsWith("--")) {
  throw new Error(
    "usage: node apps/cli-journey-e2e/scripts/verify-tarballs.mjs <tarballs-dir>",
  );
}
if (flags.length > 0) {
  throw new Error(`unknown flags: ${flags.join(", ")}`);
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
// Journey registries and release artifact dirs carry the same set: exactly
// the public release packages, nothing on top.
const requiredPackageNames = new Set(
  await Promise.all(PUBLIC_PACKAGE_DIRS.map(packageName)),
);
const dependencyFields = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];
const unsupportedProtocol = /^(catalog|workspace):/;
const semverVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const manifests = new Map();
const serverPlatformPackagePattern = /^@zitadel\/server-(?:darwin|linux|win32)-/;

const tarballs = (await readdir(tarballsDir))
  .filter((file) => file.endsWith(".tgz"))
  .sort();

if (tarballs.length === 0) {
  throw new Error(`no .tgz files found in ${tarballsDir}`);
}

for (const file of tarballs) {
  const tarball = join(tarballsDir, file);
  const manifest = readManifest(tarball);
  if (manifest.private === true) {
    throw new Error(`${tarball} contains private package ${manifest.name}`);
  }
  if (!requiredPackageNames.has(manifest.name)) {
    throw new Error(`${tarball} contains unexpected package ${manifest.name}`);
  }
  if (manifests.has(manifest.name)) {
    throw new Error(`duplicate tarball for ${manifest.name}`);
  }
  assertInstallableManifest(tarball, manifest);
  assertServerPlatformBinary(tarball, manifest);
  manifests.set(manifest.name, manifest);
}

for (const expectedName of requiredPackageNames) {
  if (!manifests.has(expectedName)) {
    throw new Error(`missing tarball for ${expectedName}`);
  }
}

assertValidVersions(manifests);

console.log(
  `verified ${manifests.size} installable tarballs; required packages present: ${[...requiredPackageNames].sort().join(", ")}`,
);

function readManifest(tarball) {
  const result = spawnSync("tar", ["-xOf", tarball, "package/package.json"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`failed to read package.json from ${tarball}: ${result.stderr}`);
  }
  const manifest = JSON.parse(result.stdout);
  if (typeof manifest.name !== "string" || typeof manifest.version !== "string") {
    throw new Error(`${tarball} has invalid package metadata`);
  }
  return manifest;
}

function assertInstallableManifest(tarball, manifest) {
  for (const field of dependencyFields) {
    const dependencies = manifest[field];
    if (!dependencies) continue;
    if (typeof dependencies !== "object" || Array.isArray(dependencies)) {
      throw new Error(`${tarball} has invalid ${field}`);
    }
    for (const [name, spec] of Object.entries(dependencies)) {
      if (typeof spec !== "string") {
        throw new Error(`${tarball} has invalid ${field}.${name}`);
      }
      if (unsupportedProtocol.test(spec)) {
        throw new Error(`${tarball} has unresolved ${field}.${name}: ${spec}`);
      }
    }
  }
}

function assertServerPlatformBinary(tarball, manifest) {
  if (!serverPlatformPackagePattern.test(manifest.name)) {
    return;
  }
  const binaryPath = manifest.name.includes("win32") ? "bin/nextgen.exe" : "bin/nextgen";
  if (!manifest.bin || manifest.bin.nextgen !== `./${binaryPath}`) {
    throw new Error(`${tarball} must declare ${manifest.name} bin.nextgen as ./${binaryPath}`);
  }
  const result = spawnSync("tar", ["-tvf", tarball, `package/${binaryPath}`], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`failed to inspect ${binaryPath} in ${tarball}: ${result.stderr}`);
  }
  const mode = result.stdout.trim().split(/\s+/, 1)[0] ?? "";
  if (!mode.includes("x")) {
    throw new Error(`${tarball} contains non-executable ${binaryPath}`);
  }
}

function assertValidVersions(manifests) {
  const invalid = [...manifests.values()]
    .filter((manifest) => !semverVersion.test(manifest.version))
    .map((manifest) => `${manifest.name}@${manifest.version}`)
    .sort();
  if (invalid.length > 0) {
    throw new Error(`public package tarballs must use semver versions: ${invalid.join(", ")}`);
  }
}

async function packageName(relativePath) {
  const pkg = JSON.parse(
    await readFile(join(repoRoot, relativePath, "package.json"), "utf8"),
  );
  if (typeof pkg.name !== "string" || pkg.name.length === 0) {
    throw new Error(`${relativePath}/package.json has no name`);
  }
  return pkg.name;
}
