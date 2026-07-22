#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { mapWithConcurrency, run, runCapture } from "./dev-process.mjs";
import {
  PUBLIC_PACKAGE_DIRS,
  PUBLIC_RELEASE_PACKAGES,
  SERVER_PLATFORM_PACKAGES,
} from "./release-manifest.mjs";

export { PUBLIC_PACKAGE_DIRS, SERVER_PLATFORM_PACKAGES } from "./release-manifest.mjs";

export const SERVER_IMAGE = "ghcr.io/zitadel/nextgen";
export const SERVER_PACKAGE = "@zitadel/server";
export const SERVER_PACKAGE_MANIFEST = "apps/server/package.json";
export const SERVER_PLATFORMS = [
  { goos: "linux", goarch: "amd64" },
  { goos: "linux", goarch: "arm64" },
  { goos: "darwin", goarch: "amd64" },
  { goos: "darwin", goarch: "arm64" },
  { goos: "windows", goarch: "amd64" },
];
export const CONTAINER_PLATFORMS = [
  { goos: "linux", goarch: "amd64" },
  { goos: "linux", goarch: "arm64" },
];

const defaultRepoRoot = fileURLToPath(new URL("..", import.meta.url));

export async function readPackageManifest(repoRoot, relativePath) {
  return JSON.parse(await readFile(join(repoRoot, relativePath), "utf8"));
}

export async function readServerRelease(repoRoot = defaultRepoRoot) {
  const manifest = await readPackageManifest(repoRoot, SERVER_PACKAGE_MANIFEST);
  if (manifest.name !== SERVER_PACKAGE) {
    throw new Error(`${SERVER_PACKAGE_MANIFEST} must be ${SERVER_PACKAGE}`);
  }
  validateSemver(manifest.version);
  return {
    name: manifest.name,
    version: manifest.version,
    tag: `v${manifest.version}`,
    prerelease: manifest.version.includes("-"),
  };
}

export function validateSemver(version) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`invalid release version: ${version}`);
  }
}

export async function gitInfo(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const runCaptureFn = options.runCapture ?? runCapture;
  const commit = (await runCaptureFn("git", ["rev-parse", "HEAD"], { cwd: repoRoot })).stdout.trim();
  const shortCommit = (await runCaptureFn("git", ["rev-parse", "--short=12", "HEAD"], {
    cwd: repoRoot,
  })).stdout.trim();
  const date = (await runCaptureFn("git", ["show", "-s", "--format=%cI", "HEAD"], {
    cwd: repoRoot,
  })).stdout.trim();
  return { commit, shortCommit, date };
}

export function releaseDir(repoRoot, version) {
  return join(repoRoot, "dist", "release", version);
}

export function binaryName(goos) {
  return goos === "windows" ? "nextgen.exe" : "nextgen";
}

export function platformName(platform) {
  return `${platform.goos}_${platform.goarch}`;
}

export function platformDir(outDir, platform) {
  return join(outDir, "build", platform.goos, platform.goarch);
}

export async function buildServerBinaries(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const version = options.version ?? (await readServerRelease(repoRoot)).version;
  const info = options.gitInfo ?? (await gitInfo({ repoRoot, runCapture: options.runCapture }));
  const outDir = options.outDir ?? releaseDir(repoRoot, version);
  const platforms = options.platforms ?? SERVER_PLATFORMS;
  const runFn = options.run ?? run;
  const baseEnv = { ...process.env, ...(options.env ?? {}) };

  // The per-platform builds are independent and the Go build cache is safe
  // under concurrency, so cross-compile all platforms at once.
  await mapWithConcurrency(platforms, platforms.length, async (platform) => {
    const dir = platformDir(outDir, platform);
    const output = join(dir, binaryName(platform.goos));
    await mkdir(dir, { recursive: true });
    await runFn(
      "go",
      [
        "build",
        "-trimpath",
        "-ldflags",
        [
          "-s -w",
          `-X main.version=${version}`,
          `-X main.commit=${info.shortCommit}`,
          `-X main.date=${info.date}`,
        ].join(" "),
        "-o",
        output,
        ".",
      ],
      {
        cwd: repoRoot,
        env: {
          ...baseEnv,
          CGO_ENABLED: "0",
          GOOS: platform.goos,
          GOARCH: platform.goarch,
        },
      },
    );
  });

  return { outDir, platforms, version, gitInfo: info };
}

export async function stageServerNpmBinaries(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const version = options.version ?? (await readServerRelease(repoRoot)).version;
  const outDir = options.outDir ?? releaseDir(repoRoot, version);
  const platforms = options.platformPackages ?? SERVER_PLATFORM_PACKAGES;

  for (const platform of platforms) {
    const source = join(platformDir(outDir, platform), binaryName(platform.goos));
    const destination = join(repoRoot, platform.packageDir, "bin", binaryName(platform.goos));
    await rm(join(repoRoot, platform.packageDir, "bin"), { recursive: true, force: true });
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
    if (platform.goos !== "windows") {
      await chmod(destination, 0o755);
    }
  }
}

export async function prepareDockerContext(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const version = options.version ?? (await readServerRelease(repoRoot)).version;
  const outDir = options.outDir ?? releaseDir(repoRoot, version);
  const contextDir = options.contextDir ?? join(outDir, "docker-context");
  const platforms = options.platforms ?? CONTAINER_PLATFORMS;

  await rm(contextDir, { recursive: true, force: true });
  for (const platform of platforms) {
    const source = join(platformDir(outDir, platform), binaryName(platform.goos));
    const destination = join(contextDir, platform.goos, platform.goarch, "nextgen");
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
  await copyFile(join(repoRoot, "Dockerfile"), join(contextDir, "Dockerfile"));
  return contextDir;
}

export async function createArchives(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const version = options.version ?? (await readServerRelease(repoRoot)).version;
  const outDir = options.outDir ?? releaseDir(repoRoot, version);
  const runFn = options.run ?? run;
  const archivesDir = join(outDir, "archives");
  await rm(archivesDir, { recursive: true, force: true });
  await mkdir(archivesDir, { recursive: true });

  const archives = [];
  for (const platform of SERVER_PLATFORMS) {
    const name = `nextgen_${version}_${platformName(platform)}`;
    const sourceDir = platformDir(outDir, platform);
    if (platform.goos === "windows") {
      const stagingDir = join(outDir, "archive-staging", name);
      await rm(stagingDir, { recursive: true, force: true });
      await mkdir(stagingDir, { recursive: true });
      await copyFile(join(sourceDir, binaryName(platform.goos)), join(stagingDir, binaryName(platform.goos)));
      await copyFile(join(repoRoot, "LICENSE"), join(stagingDir, "LICENSE"));
      await copyFile(join(repoRoot, "README.md"), join(stagingDir, "README.md"));
      const archivePath = join(archivesDir, `${name}.zip`);
      await runFn("zip", ["-qr", archivePath, "."], { cwd: stagingDir, env: process.env });
      archives.push(archivePath);
      continue;
    }

    const archivePath = join(archivesDir, `${name}.tar.gz`);
    await runFn(
      "tar",
      [
        "-czf",
        archivePath,
        "-C",
        sourceDir,
        binaryName(platform.goos),
        "-C",
        repoRoot,
        "LICENSE",
        "README.md",
      ],
      { cwd: repoRoot, env: process.env },
    );
    archives.push(archivePath);
  }

  const checksumLines = [];
  for (const archive of archives) {
    checksumLines.push(`${await sha256File(archive)}  ${archive.split("/").at(-1)}`);
  }
  const checksumPath = join(archivesDir, "checksums.txt");
  await writeFile(checksumPath, `${checksumLines.join("\n")}\n`);
  return { archives, checksumPath };
}

export async function packPublicPackages(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const version = options.version ?? (await readServerRelease(repoRoot)).version;
  const outDir = options.outDir ?? releaseDir(repoRoot, version);
  const runFn = options.run ?? run;
  const tarballsDir = join(outDir, "npm");
  await rm(tarballsDir, { recursive: true, force: true });
  await mkdir(tarballsDir, { recursive: true });

  // Packs are independent (distinct package dirs, distinct tarball names in a
  // shared destination); cap concurrency so the cli prepack rebuild and the
  // larger packages do not stampede the runner.
  await mapWithConcurrency(PUBLIC_PACKAGE_DIRS, 8, async (dir) => {
    const manifest = await readPackageManifest(repoRoot, join(dir, "package.json"));
    await assertPublishDirectoryReady({ repoRoot, dir, manifest });
    // `pnpm pack` runs the package's `prepack`, which for @zitadel/cli rebuilds
    // the bundle via tsdown. Stamp the production telemetry channel here so the
    // published tarball routes to the prod Mixpanel project — setting it only on
    // the earlier release build is not enough, since prepack rebuilds.
    const env =
      dir === "apps/cli"
        ? { ...process.env, ZITADEL_TELEMETRY_BUILD_CHANNEL: "production" }
        : process.env;
    await runFn("corepack", ["pnpm", "--dir", dir, "pack", "--pack-destination", tarballsDir], {
      cwd: repoRoot,
      env,
    });
  });

  return tarballsDir;
}

async function assertPublishDirectoryReady({ repoRoot, dir, manifest }) {
  const releasePackage = PUBLIC_RELEASE_PACKAGES.find((pkg) => pkg.dir === dir);
  if (releasePackage?.buildTarget && !(await exists(join(repoRoot, dir, "dist")))) {
    throw new Error(
      `${manifest.name} requires ${dir}/dist before packing. ` +
        `Run moon run ${releasePackage.buildTarget} or moon run release:build-public-packages.`,
    );
  }

  const publishDirectory = manifest.publishConfig?.directory;
  if (!publishDirectory) {
    return;
  }
  const manifestPath = join(repoRoot, dir, publishDirectory, "package.json");
  if (await exists(manifestPath)) {
    return;
  }
  throw new Error(
    `${manifest.name} publishConfig.directory requires ${dir}/${publishDirectory}/package.json before packing. ` +
      "The release preflight build is missing or failed.",
  );
}

export async function buildContainerImage(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const release = options.release ?? (await readServerRelease(repoRoot));
  const outDir = options.outDir ?? releaseDir(repoRoot, release.version);
  const runFn = options.run ?? run;
  const platformList = options.platforms ?? CONTAINER_PLATFORMS;
  const contextPlatforms = options.contextPlatforms ?? platformList;
  const contextDir = options.contextDir ??
    (await prepareDockerContext({
      repoRoot,
      outDir,
      version: release.version,
      platforms: contextPlatforms,
    }));
  const platformArgs = platformList.map((platform) => `${platform.goos}/${platform.goarch}`).join(",");
  const image = options.image ?? SERVER_IMAGE;
  const tags = options.tags ?? containerTags({ image, version: release.version, prerelease: release.prerelease });
  const args = ["buildx", "build", "--platform", platformArgs, "-f", join(contextDir, "Dockerfile")];

  for (const tag of tags) {
    args.push("-t", tag);
  }

  if (options.push) {
    args.push("--push");
  } else if (options.load) {
    args.push("--load");
  }

  args.push(contextDir);
  if (options.dryRun) {
    return { args, contextDir, tags };
  }
  await runFn("docker", args, { cwd: repoRoot, env: process.env });
  return { args, contextDir, tags };
}

export function containerTags({ image = SERVER_IMAGE, version, prerelease }) {
  const tags = [`${image}:${version}`];
  if (!prerelease) {
    tags.push(`${image}:latest`);
  }
  return tags;
}

export async function writeReleaseMetadata(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const release = options.release ?? (await readServerRelease(repoRoot));
  const outDir = options.outDir ?? releaseDir(repoRoot, release.version);
  const info = options.gitInfo ?? (await gitInfo({ repoRoot }));
  const packages = [];
  for (const dir of PUBLIC_PACKAGE_DIRS) {
    const manifest = await readPackageManifest(repoRoot, join(dir, "package.json"));
    packages.push({ name: manifest.name, version: manifest.version, path: dir });
  }
  const metadata = {
    version: release.version,
    tag: release.tag,
    commit: info.commit,
    shortCommit: info.shortCommit,
    date: info.date,
    image: SERVER_IMAGE,
    imageTags: containerTags({ image: SERVER_IMAGE, version: release.version, prerelease: release.prerelease }),
    packages,
  };
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
  await writeFile(join(outDir, "artifact-summary.md"), artifactSummary(metadata));
  return metadata;
}

export function artifactSummary(metadata) {
  return `# Release Artifact Summary ${metadata.version}

Commit: \`${metadata.shortCommit}\`

## Artifacts

| Kind | Reference |
|---|---|
${artifactImageRows(metadata)}

## npm Packages

| Package | Version |
|---|---|
${artifactPackageRows(metadata)}
`;
}

export function artifactImageRows(metadata) {
  return (metadata.imageTags ?? []).map((tag) => `| container | \`${tag}\` |`).join("\n");
}

export function artifactPackageRows(metadata) {
  return (metadata.packages ?? []).map((pkg) => `| \`${pkg.name}\` | \`${pkg.version}\` |`).join("\n");
}

export async function verifyLocalArtifacts(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const release = options.release ?? (await readServerRelease(repoRoot));
  const outDir = options.outDir ?? releaseDir(repoRoot, release.version);
  const missing = [];
  for (const platform of SERVER_PLATFORMS) {
    const extension = platform.goos === "windows" ? "zip" : "tar.gz";
    const archive = join(outDir, "archives", `nextgen_${release.version}_${platformName(platform)}.${extension}`);
    if (!(await exists(archive))) {
      missing.push(archive);
    }
  }
  const checksumPath = join(outDir, "archives", "checksums.txt");
  if (!(await exists(checksumPath))) {
    missing.push(checksumPath);
  }
  const npmTarballs = (await exists(join(outDir, "npm"))) ? await readdir(join(outDir, "npm")) : [];
  if (npmTarballs.length < PUBLIC_PACKAGE_DIRS.length) {
    missing.push(`${join(outDir, "npm")}/*`);
  }
  if (missing.length > 0) {
    throw new Error(`missing release artifacts:\n${missing.join("\n")}`);
  }
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function sha256File(path) {
  return await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}
