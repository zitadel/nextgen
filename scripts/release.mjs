#!/usr/bin/env node
import { realpath, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { forwardedArgs, isDirectRun, run, runCapture } from "./dev-process.mjs";
import { upsertProductGithubRelease } from "./release-github.mjs";
import {
  findPublishBlockers,
  publishBlockersMessage,
  readLocalPackages,
} from "./release-npm-preflight.mjs";
import {
  PUBLIC_PACKAGE_DIRS,
  SERVER_PLATFORM_PACKAGES,
  hostOnlyPackageDirs,
  hostServerPlatformPackage,
} from "./release-manifest.mjs";
import { detectReleaseAutomation } from "./release-automation.mjs";
import {
  CONTAINER_PLATFORMS,
  assertServerBinaries,
  buildContainerImage,
  buildServerBinaries,
  collectServerBinaries,
  createArchives,
  gitInfo,
  packageBinaryPath,
  packPublicPackages,
  prepareDockerContext,
  readServerRelease,
  releaseDir,
  stageServerNpmBinaries,
  verifyLocalArtifacts,
  writeReleaseMetadata,
} from "./release-artifacts.mjs";
import { serverModuleRoot } from "./server-build.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// `--prebuilt` (turbo's pack, snapshot and publish, tools/release/package.json):
// the task graph has already built what ships, every public package's dist
// and each server platform package's binary (`binary` below), so these
// commands pack it instead of building the binaries. Moon's release graph
// runs them without it; the option becomes the only behavior with moon's
// removal.

export async function main(args = forwardedArgs()) {
  const command = args[0];
  const options = parseOptions(args.slice(1));

  switch (command) {
    case "version":
      return await commandVersion();
    case "binary":
      return await commandBinary(options);
    case "snapshot":
      return await commandSnapshot(options);
    case "pack":
      return await commandPack(options);
    case "publish":
      return await commandPublish(options);
    case "check-npm":
      return await commandCheckNpm();
    case "verify":
      return await commandVerify();
    default:
      usage(command ? `unknown release command: ${command}` : undefined);
  }
}

async function commandVersion() {
  const release = await readServerRelease(repoRoot);
  console.log(`${release.name} ${release.version} (${release.tag})`);
}

/**
 * The release binary of the server platform package this runs in
 * (apps/server-<platform>, its build-binary task), into the bin/ its npm
 * package ships. A host-only release builds this machine's platform only:
 * the other packages remove their binary, so no later pack ships a stale
 * one.
 */
async function commandBinary(options, cwd = process.cwd()) {
  const here = await realpath(cwd);
  let platformPackage;
  for (const entry of SERVER_PLATFORM_PACKAGES) {
    if ((await realpath(join(repoRoot, entry.packageDir))) === here) platformPackage = entry;
  }
  if (!platformPackage) {
    throw new Error(`release binary runs in a server platform package, not in ${cwd}`);
  }
  const output = packageBinaryPath(repoRoot, platformPackage);
  if (options.hostOnly && platformPackage.packageDir !== hostServerPlatformPackage().packageDir) {
    await rm(dirname(output), { recursive: true, force: true });
    console.log(`${platformPackage.packageName}: not built, the release is host-only`);
    return;
  }
  const release = await readServerRelease(repoRoot);
  await buildServerBinaries({
    repoRoot,
    version: release.version,
    gitInfo: await gitInfo({ repoRoot }),
    platforms: [platformPackage],
    output: () => output,
  });
}

async function commandSnapshot(options) {
  const release = await readServerRelease(repoRoot);
  const outDir = releaseDir(repoRoot, release.version);
  const info = await gitInfo({ repoRoot });
  // A host-only snapshot is for installing on this machine: one server
  // platform, its npm package, no archives and no Docker context.
  if (options.hostOnly && !options.skipContainer) {
    throw new Error("a host-only snapshot has no Docker context: add --skip-container");
  }
  const host = options.hostOnly ? hostServerPlatformPackage() : undefined;

  if (options.prebuilt) {
    // The binaries are in their platform packages; the archives and the
    // Docker context read them from the release directory.
    if (host) {
      await assertServerBinaries({ repoRoot, platformPackages: [host] });
    } else {
      await collectServerBinaries({ repoRoot, outDir, version: release.version });
    }
  } else {
    await run("go", ["mod", "download"], { cwd: serverModuleRoot(repoRoot) });
    await buildServerBinaries({
      repoRoot,
      outDir,
      version: release.version,
      gitInfo: info,
      platforms: host ? [host] : undefined,
    });
  }
  // Independent lanes over the built binaries, run side by side: each
  // writes only its own output (the platform packages' bin/ and then npm/,
  // archives/, docker-context/). Every lane settles before the first failure
  // is rethrown, so a failing lane never leaves another's processes running.
  const lanes = await Promise.allSettled([
    (async () => {
      if (!options.prebuilt) {
        await stageServerNpmBinaries({
          repoRoot,
          outDir,
          version: release.version,
          platformPackages: host ? [host] : undefined,
        });
      }
      await packPublicPackages({
        repoRoot,
        outDir,
        version: release.version,
        dirs: host ? hostOnlyPackageDirs(host) : undefined,
      });
    })(),
    ...(host
      ? []
      : [
          createArchives({ repoRoot, outDir, version: release.version }),
          prepareDockerContext({ repoRoot, outDir, version: release.version }),
        ]),
  ]);
  const failedLane = lanes.find((lane) => lane.status === "rejected");
  if (failedLane) {
    throw failedLane.reason;
  }
  await writeReleaseMetadata({ repoRoot, outDir, release, gitInfo: info });

  if (!options.skipContainer) {
    await buildContainerImage({
      repoRoot,
      outDir,
      release,
      load: true,
      platforms: [hostLinuxPlatform()],
      tags: [`ghcr.io/zitadel/nextgen:${release.version}-snapshot-local`],
    });
  }

  await verifyLocalArtifacts({ repoRoot, outDir, release, hostOnly: Boolean(host) });
  console.log(`release snapshot ready: ${outDir}`);
}

async function commandPack(options) {
  const release = await readServerRelease(repoRoot);
  const outDir = releaseDir(repoRoot, release.version);
  if (options.prebuilt) {
    await assertServerBinaries({ repoRoot });
  } else {
    const info = await gitInfo({ repoRoot });
    await run("go", ["mod", "download"], { cwd: serverModuleRoot(repoRoot) });
    await buildServerBinaries({ repoRoot, outDir, version: release.version, gitInfo: info });
    await stageServerNpmBinaries({ repoRoot, outDir, version: release.version });
  }
  await packPublicPackages({ repoRoot, outDir, version: release.version });
  console.log(`npm tarballs ready: ${join(outDir, "npm")}`);
}

async function commandPublish(options) {
  const release = await readServerRelease(repoRoot);
  const outDir = releaseDir(repoRoot, release.version);
  if (options.recoverVersion) {
    assertRecoverVersion(release, options.recoverVersion);
  } else {
    const preflight = await detectReleaseAutomation({
      repoRoot,
      mode: "publish",
      base: options.base || process.env.BASE_SHA || "HEAD^",
    });
    if (!preflight.ok) {
      const message = [
        `release publish preflight failed: ${preflight.reason}`,
        ...preflight.errors.map((error) => `- ${error}`),
      ].join("\n");
      throw new Error(message);
    }
    if (!preflight.shouldRun) {
      const message = `release publish: skip - ${preflight.reason}`;
      if (shouldFailManualPublishSkip(options)) {
        throw new Error(
          [
            message,
            "manual release dispatch would not publish anything; " +
              `pass recover_version=${release.version} to recover this checked-out version, ` +
              "or run from a Changesets version package commit.",
          ].join("\n"),
        );
      }
      console.log(message);
      return;
    }
  }

  await assertMainBranch(options, { allowDryRunBypass: !options.recoverVersion });
  await assertPackagesPublishable();

  if (options.dryRun) {
    await commandSnapshot({ skipContainer: true, prebuilt: options.prebuilt });
    await buildContainerImage({
      repoRoot,
      outDir,
      release,
      dryRun: true,
      push: true,
      platforms: CONTAINER_PLATFORMS,
    });
    await upsertProductGithubRelease({ repoRoot, outDir, dryRun: true, log: console.log });
    console.log(
      "dry run: would publish npm packages, push container images, and update the draft GitHub Release",
    );
    return;
  }

  await commandSnapshot({ skipContainer: true, prebuilt: options.prebuilt });
  await run("corepack", ["pnpm", "exec", "changeset", "publish"], {
    cwd: repoRoot,
    env: releasePublishEnv(),
  });
  await buildContainerImage({
    repoRoot,
    outDir,
    release,
    push: true,
    platforms: CONTAINER_PLATFORMS,
  });
  await commandVerify();
  await upsertProductGithubRelease({ repoRoot, outDir, log: console.log });
}

// Fails before anything is published when `changeset publish` would publish a
// package npm has never seen, which trusted publishing cannot create (see
// release-npm-preflight.mjs).
async function assertPackagesPublishable() {
  const packages = await readLocalPackages(repoRoot, PUBLIC_PACKAGE_DIRS);
  const blockers = await findPublishBlockers(packages);
  if (blockers.unpublished.length > 0) {
    throw new Error(publishBlockersMessage(blockers));
  }
}

// The publish preflight's npm check, on its own. ci.yml runs it on the version
// PR and its merge group, so a version that release publish would refuse fails
// before it lands on main, not after.
async function commandCheckNpm() {
  const release = await readServerRelease(repoRoot);
  await assertPackagesPublishable();
  console.log(`npm preflight passed for ${release.version}`);
}

function assertRecoverVersion(release, recoverVersion) {
  if (release.version !== recoverVersion) {
    throw new Error(
      `release publish recovery requires checked-out server version ${recoverVersion}, got ${release.version}`,
    );
  }
}

async function commandVerify() {
  const release = await readServerRelease(repoRoot);
  await verifyLocalArtifacts({ repoRoot, release, outDir: releaseDir(repoRoot, release.version) });
  console.log(`release artifacts verified for ${release.version}`);
}

// RELEASE_SKIP_CONTAINER=1, RELEASE_HOST_ONLY=1, RELEASE_DRY_RUN=1 and
// RECOVER_VERSION are --skip-container, --host-only, --dry-run and
// --recover-version for the workflows' turbo runs, which cannot pass them
// after `--`: turbo
// puts those arguments into the cache key of every task in the run
// (vercel/turborepo#14770), so the whole release graph would be rebuilt
// instead of restored.
function parseOptions(args, env = process.env) {
  const parsed = {
    dryRun: env.RELEASE_DRY_RUN === "1",
    skipContainer: env.RELEASE_SKIP_CONTAINER === "1",
    hostOnly: env.RELEASE_HOST_ONLY === "1",
    prebuilt: false,
    recoverVersion: env.RECOVER_VERSION ?? "",
    base: "",
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--dry-run":
        parsed.dryRun = true;
        break;
      case "--skip-container":
        parsed.skipContainer = true;
        break;
      case "--host-only":
        parsed.hostOnly = true;
        break;
      case "--prebuilt":
        parsed.prebuilt = true;
        break;
      case "--recover-version":
        parsed.recoverVersion = args[++index] ?? "";
        if (!parsed.recoverVersion) usage("--recover-version requires a value");
        break;
      case "--base":
        parsed.base = args[++index] ?? "";
        if (!parsed.base) usage("--base requires a value");
        break;
      case "--help":
      case "-h":
        usage();
        break;
      default:
        usage(`unknown option: ${arg}`);
    }
  }
  return parsed;
}

export function releasePublishEnv(overrides = {}) {
  return { ...process.env, ...overrides };
}

export function shouldFailManualPublishSkip(options = {}, env = process.env) {
  return (
    env.GITHUB_EVENT_NAME === "workflow_dispatch" && !options.dryRun && !options.recoverVersion
  );
}

async function assertMainBranch(options, { allowDryRunBypass = true } = {}) {
  if ((allowDryRunBypass && options.dryRun) || process.env.GITHUB_REF === "refs/heads/main") {
    return;
  }
  const branch = (
    await runCapture("git", ["branch", "--show-current"], { cwd: repoRoot })
  ).stdout.trim();
  if (branch !== "main") {
    throw new Error(`release publish must run from main, got ${branch || "detached HEAD"}`);
  }
}

function hostLinuxPlatform() {
  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  return { goos: "linux", goarch: arch };
}

function usage(error) {
  if (error) {
    console.error(error);
    console.error("");
  }
  console.log(`usage: node scripts/release.mjs <version|binary|pack|snapshot|publish|check-npm|verify> [options]

Commands:
  binary             Build the release binary of the server platform package
                     this runs in (apps/server-<platform>) into its bin/.
                     With --host-only, any other platform removes its binary.

Options:
  --dry-run          Do not publish or mutate remote registries.
  --skip-container   Build release files without building a local Docker image
                     (or set RELEASE_SKIP_CONTAINER=1).
  --host-only        snapshot: build and pack only this machine's server
                     platform, without archives or a Docker context;
                     needs --skip-container
                     (or set RELEASE_HOST_ONLY=1).
  --prebuilt         pack, snapshot, publish: pack the dists and server binaries
                     the task graph built (turbo) instead of building the
                     binaries here.
  --recover-version <v>
                     Publish recovery target version from release-publish.
  --base <ref>       Base ref for release publish detection.
`);
  process.exit(error ? 1 : 0);
}

if (isDirectRun(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(error?.code ?? 1);
  }
}
