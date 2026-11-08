#!/usr/bin/env node
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { forwardedArgs, isDirectRun, run, runCapture } from "./dev-process.mjs";
import { upsertProductGithubRelease } from "./release-github.mjs";
import {
  findPublishBlockers,
  publishBlockersMessage,
  readLocalPackages,
} from "./release-npm-preflight.mjs";
import { PUBLIC_PACKAGE_DIRS, SERVER_PLATFORM_PACKAGES } from "./release-manifest.mjs";
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
  verifyLocalArtifacts,
  writeReleaseMetadata,
} from "./release-artifacts.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// pack, snapshot and publish pack what the task graph built before them
// (turbo's tasks, tools/release/package.json): every public package's dist and
// each server platform package's binary (`binary` below).

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
      return await commandPack();
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
 * package ships.
 */
async function commandBinary(_options, cwd = process.cwd()) {
  const here = await realpath(cwd);
  let platformPackage;
  for (const entry of SERVER_PLATFORM_PACKAGES) {
    if ((await realpath(join(repoRoot, entry.packageDir))) === here) platformPackage = entry;
  }
  if (!platformPackage) {
    throw new Error(`release binary runs in a server platform package, not in ${cwd}`);
  }
  const output = packageBinaryPath(repoRoot, platformPackage);
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

  // The binaries are in their platform packages; the archives and the
  // Docker context read them from the release directory.
  await collectServerBinaries({ repoRoot, outDir, version: release.version });
  // Independent lanes over the built binaries, run side by side: each
  // writes only its own output (npm/, archives/, docker-context/). Every
  // lane settles before the first failure is rethrown, so a failing lane
  // never leaves another's processes running.
  const lanes = await Promise.allSettled([
    packPublicPackages({ repoRoot, outDir, version: release.version }),
    createArchives({ repoRoot, outDir, version: release.version }),
    prepareDockerContext({ repoRoot, outDir, version: release.version }),
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

  await verifyLocalArtifacts({ repoRoot, outDir, release });
  console.log(`release snapshot ready: ${outDir}`);
}

async function commandPack() {
  const release = await readServerRelease(repoRoot);
  const outDir = releaseDir(repoRoot, release.version);
  await assertServerBinaries({ repoRoot });
  const tarballsDir = await packPublicPackages({ repoRoot, outDir, version: release.version });
  // Exactly the public release packages, each installable: what CI checks of
  // the full set (each journey checks only the tarballs it installs).
  await run("node", ["e2e/journey/scripts/verify-tarballs.mjs", tarballsDir], { cwd: repoRoot });
  console.log(`npm tarballs ready: ${tarballsDir}`);
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
    await commandSnapshot({ skipContainer: true });
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

  await commandSnapshot({ skipContainer: true });
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

// The publish preflight's npm check, on its own: @zitadel/release#check-npm,
// which CI runs whenever a public package's manifest changes (the version PR
// and its merge group among them), so a version that release publish would
// refuse fails before it lands on main, not after.
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

// RELEASE_SKIP_CONTAINER=1, RELEASE_DRY_RUN=1 and RECOVER_VERSION are
// --skip-container, --dry-run and --recover-version for the workflows'
// turbo runs, which cannot pass them after `--`: turbo puts those
// arguments into the cache key of every task in the run
// (vercel/turborepo#14770), so the whole release graph would be rebuilt
// instead of restored.
function parseOptions(args, env = process.env) {
  const parsed = {
    dryRun: env.RELEASE_DRY_RUN === "1",
    skipContainer: env.RELEASE_SKIP_CONTAINER === "1",
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

Options:
  --dry-run          Do not publish or mutate remote registries.
  --skip-container   Build release files without building a local Docker image
                     (or set RELEASE_SKIP_CONTAINER=1).
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
