import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const tarballsDir = process.argv[2];
if (!tarballsDir) {
  throw new Error("usage: node scripts/publish-tarballs.mjs <tarballs-dir>");
}

const registryUrl = process.env.JOURNEY_REGISTRY_URL ?? "http://127.0.0.1:4873";
const tarballs = (await readdir(tarballsDir))
  .filter((file) => file.endsWith(".tgz"))
  .sort();

if (tarballs.length === 0) {
  throw new Error(`no .tgz files found in ${tarballsDir}`);
}

for (const file of tarballs) {
  const tarball = join(tarballsDir, file);
  const manifest = readManifest(tarball);
  run("npm", [
    "publish",
    tarball,
    "--registry",
    registryUrl,
    "--tag",
    "alpha",
    "--access",
    "public",
    "--ignore-scripts",
    "--loglevel",
    "error",
  ]);
  run("npm", [
    "dist-tag",
    "add",
    `${manifest.name}@${manifest.version}`,
    "latest",
    "--registry",
    registryUrl,
    "--loglevel",
    "error",
  ]);
  console.log(`published ${manifest.name}@${manifest.version} as alpha and latest`);
}

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

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
  });
  if (result.error) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = result.signal ?? result.status ?? "unknown status";
    throw new Error(`${command} ${args.join(" ")} failed with ${detail}`);
  }
}
