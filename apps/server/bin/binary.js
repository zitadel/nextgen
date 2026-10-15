import { chmodSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

export const supportedPlatforms = [
  { platform: "darwin", arch: "arm64", packageName: "@zitadel/server-darwin-arm64" },
  { platform: "darwin", arch: "x64", packageName: "@zitadel/server-darwin-x64" },
  { platform: "linux", arch: "arm64", packageName: "@zitadel/server-linux-arm64" },
  { platform: "linux", arch: "x64", packageName: "@zitadel/server-linux-x64" },
  { platform: "win32", arch: "x64", packageName: "@zitadel/server-win32-x64" },
];

export function platformPackageName(platform = process.platform, arch = process.arch) {
  const match = supportedPlatforms.find((candidate) => {
    return candidate.platform === platform && candidate.arch === arch;
  });
  if (!match) {
    const supported = supportedPlatforms
      .map((candidate) => `${candidate.platform}/${candidate.arch}`)
      .join(", ");
    throw new Error(
      `Unsupported platform for @zitadel/server: ${platform}/${arch}. Supported: ${supported}.`,
    );
  }
  return match.packageName;
}

/**
 * Where the `nextgen` server binary for a platform is, without looking at the
 * file: the platform package must be installed, but the binary need not be built.
 * The platform package is an optional dependency of this package, so it is
 * resolved from here, where a strict package manager exposes it, and not from
 * the caller.
 */
export function serverBinaryPath(platform = process.platform, arch = process.arch) {
  const packageName = platformPackageName(platform, arch);
  let manifestPath;
  try {
    manifestPath = require.resolve(`${packageName}/package.json`);
  } catch (error) {
    throw new Error(
      `Missing ${packageName}. Reinstall @zitadel/server so npm can install the optional platform package.`,
      { cause: error },
    );
  }
  return join(dirname(manifestPath), "bin", platform === "win32" ? "nextgen.exe" : "nextgen");
}

/** The server binary for a platform, ready to run: it must exist, and is made executable. */
export function resolveServerBinary(platform = process.platform, arch = process.arch) {
  const binaryPath = serverBinaryPath(platform, arch);
  if (!existsSync(binaryPath)) {
    throw new Error(
      `Missing Zitadel server binary at ${binaryPath}. Reinstall ${platformPackageName(platform, arch)}.`,
    );
  }
  ensureExecutable(binaryPath, platform);
  return binaryPath;
}

export function ensureExecutable(binaryPath, platform = process.platform) {
  if (platform === "win32") {
    return;
  }
  try {
    chmodSync(binaryPath, 0o755);
  } catch (error) {
    throw new Error(
      `Zitadel server binary at ${binaryPath} is not executable and could not be fixed.`,
      {
        cause: error,
      },
    );
  }
}
