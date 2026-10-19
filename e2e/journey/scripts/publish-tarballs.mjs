import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

import { readManifest } from "./lib.mjs";

const tarballsDir = process.argv[2];
if (!tarballsDir) {
  throw new Error("usage: node scripts/publish-tarballs.mjs <tarballs-dir>");
}

const registryUrl = process.env.JOURNEY_REGISTRY_URL ?? "http://127.0.0.1:4873";
const tarballs = (await readdir(tarballsDir)).filter((file) => file.endsWith(".tgz")).sort();

if (tarballs.length === 0) {
  throw new Error(`no .tgz files found in ${tarballsDir}`);
}

// Checked for every tarball before the first publish, so a private package
// stops the run with nothing half-published.
const packages = tarballs.map((file) => {
  const tarball = join(tarballsDir, file);
  const manifest = readManifest(tarball);
  if (manifest.private === true) {
    throw new Error(`refusing to publish private package ${manifest.name} from ${tarball}`);
  }
  return { tarball, manifest };
});

// Each package is two npm calls, mostly npm's own start-up time; one after
// the other, the 20 packages took ~14 s of every journey run. They are
// independent of each other, so a few run at once.
await mapWithConcurrency(packages, 6, async ({ tarball, manifest }) => {
  await run("npm", [
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
  await run("npm", [
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
});

// After the first failure no lane starts another item; the ones in flight
// finish before the error is thrown, so no npm process outlives the script.
async function mapWithConcurrency(items, limit, worker) {
  let next = 0;
  let failure;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length && !failure) {
      const item = items[next];
      next += 1;
      try {
        await worker(item);
      } catch (error) {
        failure ??= error;
      }
    }
  });
  await Promise.all(lanes);
  if (failure) {
    throw failure;
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", (error) => {
      reject(new Error(`${command} ${args.join(" ")} failed: ${error.message}`));
    });
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = signal ?? code ?? "unknown status";
      reject(new Error(`${command} ${args.join(" ")} failed with ${detail}`));
    });
  });
}
