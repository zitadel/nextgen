#!/usr/bin/env node
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { forwardedArgs, isDirectRun, run, runCapture } from "./dev-process.mjs";
import { upsertProductGithubRelease } from "./release-github.mjs";
import {
  findPublishBlockers,
  publishBlockersMessage,
  readLocalPackages,
} from "./release-npm-preflight.mjs";
import { PUBLIC_PACKAGE_DIRS } from "./release-manifest.mjs";
import { detectReleaseAutomation } from "./release-automation.mjs";
import {
  CONTAINER_PLATFORMS,
  buildContainerImage,
  buildServerBinaries,
  createArchives,
  gitInfo,
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

export async function main(args = forwardedArgs()) {
  const command = args[0];
  const options = parseOptions(args.slice(1));

  switch (command) {
    case "version":
      return await commandVersion();
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

async function commandSnapshot(options) {
  const release = await readServerRelease(repoRoot);
  const outDir = releaseDir(repoRoot, release.version);
  const info = await gitInfo({ repoRoot });

  await run("go", ["mod", "download"], { cwd: serverModuleRoot(repoRoot) });
  await buildServerBinaries({ repoRoot, outDir, version: release.version, gitInfo: info });
  // Three independent lanes over the built binaries, run side by side: each
  // writes only its own output (the platform packages' bin/ and then npm/,
  // archives/, docker-context/). Every lane settles before the first failure
  // is rethrown, so a failing lane never leaves another's processes running.
  const lanes = await Promise.allSettled([
    (async () => {
      await stageServerNpmBinaries({ repoRoot, outDir, version: release.version });
      await packPublicPackages({ repoRoot, outDir, version: release.version });
    })(),
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
  const info = await gitInfo({ repoRoot });
  await run("go", ["mod", "download"], { cwd: serverModuleRoot(repoRoot) });
  await buildServerBinaries({ repoRoot, outDir, version: release.version, gitInfo: info });
  await stageServerNpmBinaries({ repoRoot, outDir, version: release.version });
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

// RELEASE_SKIP_CONTAINER=1 is --skip-container for CI's turbo job, which
// cannot pass it after `--`: turbo puts those arguments into the cache key of
// every task in the run (vercel/turborepo#14770), so the whole release graph
// would be rebuilt instead of restored.
function parseOptions(args, env = process.env) {
  const parsed = {
    dryRun: false,
    skipContainer: env.RELEASE_SKIP_CONTAINER === "1",
    recoverVersion: "",
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
  console.log(`usage: node scripts/release.mjs <version|pack|snapshot|publish|check-npm|verify> [options]

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
