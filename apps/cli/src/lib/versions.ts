import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const PREVIEW_NPM_DIST_TAG = "preview";
export const PREVIEW_LOCAL_SERVER_IMAGE_REPOSITORY = "ghcr.io/zitadel/zitadel-preview";

const RELEASE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/;
const TEST_VERSION = /^0\.0\.0-test(?:$|[.-])/;
const WORKSPACE_PROTOCOL = /^(catalog|workspace):/;

const workspacePackagePaths = new Map<string, string>([
  ["@zitadel/sdk-next", "packages/sdk-next/package.json"],
]);

export type PackageJsonLike = {
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  optionalDependencies?: Record<string, unknown>;
  peerDependencies?: Record<string, unknown>;
};

export function releaseVersion(version: string): string | undefined {
  const normalized = version.trim().replace(/^v/, "");
  if (!RELEASE_VERSION.test(normalized) || TEST_VERSION.test(normalized)) {
    return undefined;
  }
  return normalized;
}

export function npmDistTagForVersion(version: string): string {
  const normalized = releaseVersion(version);
  return normalized && !normalized.includes("-") ? "latest" : PREVIEW_NPM_DIST_TAG;
}

export function defaultPreviewImageForVersion(version: string): string {
  return `${PREVIEW_LOCAL_SERVER_IMAGE_REPOSITORY}:${releaseVersion(version) ?? PREVIEW_NPM_DIST_TAG}`;
}

export async function resolvePackageVersions(
  packageNames: ReadonlyArray<string>,
  options: {
    cliRoot: string;
    packageJson: PackageJsonLike;
  },
): Promise<Record<string, string>> {
  const resolved: Record<string, string> = {};
  for (const name of packageNames) {
    const workspaceVersion = await readWorkspacePackageVersion(options.cliRoot, name);
    const manifestVersion = readPackageJsonDependencyVersion(options.packageJson, name);
    const version = workspaceVersion ?? manifestVersion;
    if (version) {
      resolved[name] = version;
    }
  }
  return resolved;
}

async function readWorkspacePackageVersion(
  cliRoot: string,
  packageName: string,
): Promise<string | undefined> {
  const workspacePath = workspacePackagePaths.get(packageName);
  if (!workspacePath) {
    return undefined;
  }
  try {
    const manifest = JSON.parse(
      await readFile(resolve(cliRoot, "../..", workspacePath), "utf8"),
    ) as { name?: unknown; version?: unknown };
    if (manifest.name !== packageName || typeof manifest.version !== "string") {
      return undefined;
    }
    return releaseVersion(manifest.version);
  } catch {
    return undefined;
  }
}

function readPackageJsonDependencyVersion(
  packageJson: PackageJsonLike,
  packageName: string,
): string | undefined {
  for (const field of [
    packageJson.dependencies,
    packageJson.devDependencies,
    packageJson.optionalDependencies,
    packageJson.peerDependencies,
  ]) {
    const candidate = field?.[packageName];
    if (typeof candidate === "string" && !WORKSPACE_PROTOCOL.test(candidate)) {
      return releaseVersion(candidate);
    }
  }
  return undefined;
}
