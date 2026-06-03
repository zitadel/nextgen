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
    "--ignore-scripts",
  ]);
  run("npm", [
    "dist-tag",
    "add",
    `${manifest.name}@${manifest.version}`,
    "latest",
    "--registry",
    registryUrl,
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
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited ${result.status}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
}
