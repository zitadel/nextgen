import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const tarballsDir = process.argv[2];
if (!tarballsDir) {
  throw new Error("usage: node scripts/verify-tarballs.mjs <tarballs-dir>");
}

const expectedPackageNames = new Set([
  "@zitadel/cli",
  "@zitadel/api",
  "@zitadel/components",
  "@zitadel/sdk-core",
  "@zitadel/sdk-next",
  "@zitadel/sdk-nuxt",
]);
const dependencyFields = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];
const unsupportedProtocol = /^(catalog|workspace):/;
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
  if (!expectedPackageNames.has(manifest.name)) {
    throw new Error(`${tarball} contains unexpected package ${manifest.name}`);
  }
  if (manifests.has(manifest.name)) {
    throw new Error(`duplicate tarball for ${manifest.name}`);
  }
  assertInstallableManifest(tarball, manifest);
  manifests.set(manifest.name, manifest);
}

for (const expectedName of expectedPackageNames) {
  if (!manifests.has(expectedName)) {
    throw new Error(`missing tarball for ${expectedName}`);
  }
}

console.log(
  `verified ${manifests.size} installable tarballs: ${[...manifests.keys()].sort().join(", ")}`,
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
