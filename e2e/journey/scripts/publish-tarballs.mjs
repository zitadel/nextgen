import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import pMap from "p-map";

import { readManifest } from "./lib.mjs";
import { publishBody } from "./publish-body.mjs";

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

// The request `npm publish` sends, from this process: two npm processes per
// package took 7 s for a journey's 13 packages on an otherwise idle CI
// runner and 24 s beside the other journeys. A few at once: the server
// platform packages' bodies are about 35 MB each.
await pMap(
  packages,
  async ({ tarball, manifest }) => {
    const body = publishBody(manifest, await readFile(tarball), registryUrl, ["alpha", "latest"]);
    const response = await fetch(`${registryUrl}/${manifest.name.replaceAll("/", "%2f")}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) {
      throw new Error(
        `publishing ${manifest.name}@${manifest.version} to ${registryUrl} failed with ${response.status}: ${(await response.text()).slice(0, 1000)}`,
      );
    }
    console.log(`published ${manifest.name}@${manifest.version} as alpha and latest`);
  },
  { concurrency: 4 },
);
