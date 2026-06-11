import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const tarballsDir = process.argv[2];
if (!tarballsDir) {
  throw new Error("usage: node scripts/verify-tarballs.mjs <tarballs-dir>");
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const requiredPackageDirs = [
  "apps/cli",
  "packages/api",
  "packages/components",
  "packages/sdk-core",
  "packages/sdk-next",
  "packages/sdk-nuxt",
  "packages/sdk-react",
  "packages/sdk-vue",
  "packages/sdk-angular",
];
const requiredPackageNames = new Set(
  await Promise.all(requiredPackageDirs.map(packageName)),
);
const dependencyFields = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];
const unsupportedProtocol = /^(catalog|workspace):/;
const alphaVersion = /^\d+\.\d+\.\d+-alpha\.\d+$/;
const manifests = new Map();

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
  manifests.set(manifest.name, manifest);
}

for (const expectedName of requiredPackageNames) {
  if (!manifests.has(expectedName)) {
    throw new Error(`missing tarball for ${expectedName}`);
  }
}

assertLockstepAlphaVersions(manifests);

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

function assertLockstepAlphaVersions(manifests) {
  const versions = new Set([...manifests.values()].map((manifest) => manifest.version));
  if (versions.size !== 1) {
    throw new Error(
      `public package tarballs must use one lockstep alpha version: ${[...manifests.values()]
        .map((manifest) => `${manifest.name}@${manifest.version}`)
        .sort()
        .join(", ")}`,
    );
  }
  const version = [...versions][0];
  if (!alphaVersion.test(version)) {
    throw new Error(`public package tarballs must use an alpha train version: ${version}`);
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
