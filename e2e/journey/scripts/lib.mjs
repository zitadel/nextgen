import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Helpers the journey scripts had each written out the same way. The process
 * runners, the concurrency pools and `npmEnvironment` stay in their scripts on
 * purpose: they only look alike. The npm environments, for one, drop different
 * keys — prepare-app's keeps the upper-case NPM_CONFIG_USERCONFIG the runner
 * passes, which is what points npm at the journey registry's npmrc
 * (local-registry.test.mjs pins local-registry's).
 */

export function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/** `value` as a TCP port, or a failure naming the setting it came from. */
export function parsePort(value, name) {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`${name} must be a TCP port, got ${value}`);
  }
  return port;
}

/** The name in `<repoRoot>/<relativePath>/package.json`. */
export async function packageName(repoRoot, relativePath, readFileFn = readFile) {
  const manifest = JSON.parse(
    await readFileFn(join(repoRoot, relativePath, "package.json"), "utf8"),
  );
  if (typeof manifest.name !== "string" || manifest.name.length === 0) {
    throw new Error(`${relativePath}/package.json has no name`);
  }
  return manifest.name;
}

/** The `package.json` packed into an npm tarball. */
export function readManifest(tarball) {
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
