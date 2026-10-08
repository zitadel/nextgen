#!/usr/bin/env node
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { forwardedArgs, isDirectRun, run, runCapture } from "./dev-process.mjs";
import { upsertProductGithubRelease } from "./release-github.mjs";
import {
  detectReleaseAutomation,
  findUnrecordedPendingChangesets,
  readPrereleaseChangesetIds,
  readReleaseChangesets,
} from "./release-automation.mjs";
import {
  CONTAINER_PLATFORMS,
  SERVER_IMAGE,
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

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export async function main(args = forwardedArgs()) {
  const command = args[0];
  const options = parseOptions(args.slice(1));

  switch (command) {
    case "version":
      return await commandVersion();
    case "snapshot":
      return await commandSnapshot(options);
    case "image":
      return await commandImage(options);
    case "pack":
      return await commandPack();
    case "publish":
      return await commandPublish(options);
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

  await run("go", ["mod", "download"], { cwd: repoRoot });
  await buildServerBinaries({ repoRoot, outDir, version: release.version, gitInfo: info });
  await stageServerNpmBinaries({ repoRoot, outDir, version: release.version });
  await createArchives({ repoRoot, outDir, version: release.version });
  await packPublicPackages({ repoRoot, outDir, version: release.version });
  await prepareDockerContext({ repoRoot, outDir, version: release.version });
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

/**
 * Builds the server container for one commit and optionally pushes it. This is
 * the "main is production" artifact: the hosted cloud deploys every commit on
 * `main` from `ghcr.io/zitadel/nextgen:sha-<commit>` (immutable) while the
 * version tags remain the self-hoster artifact. Platforms default to
 * linux/amd64 (what Vercel runs); tags default to the commit's sha tag.
 */
async function commandImage(options) {
  const release = await readServerRelease(repoRoot);
  const outDir = releaseDir(repoRoot, release.version);
  const info = await gitInfo({ repoRoot });
  const platforms = options.platforms.length > 0 ? options.platforms : [LINUX_AMD64];
  const tags =
    options.tags.length > 0
      ? options.tags.map((tag) => (tag.includes(":") ? tag : `${SERVER_IMAGE}:${tag}`))
      : [`${SERVER_IMAGE}:sha-${info.commit}`];

  await run("go", ["mod", "download"], { cwd: repoRoot });
  await buildServerBinaries({
    repoRoot,
    outDir,
    version: release.version,
    gitInfo: info,
    platforms,
  });
  await buildContainerImage({
    repoRoot,
    outDir,
    release,
    platforms,
    contextPlatforms: platforms,
    tags,
    push: options.push,
    load: !options.push,
  });
  console.log(`container image ${options.push ? "pushed" : "built"}: ${tags.join(", ")}`);
}

const LINUX_AMD64 = { goos: "linux", goarch: "amd64" };

function parsePlatform(value) {
  const [goos, goarch] = value.split("/");
  if (!goos || !goarch) usage(`--platform expects <goos>/<goarch>, got "${value}"`);
  return { goos, goarch };
}

async function commandPack() {
  const release = await readServerRelease(repoRoot);
  const outDir = releaseDir(repoRoot, release.version);
  const info = await gitInfo({ repoRoot });
  await run("go", ["mod", "download"], { cwd: repoRoot });
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

  await assertNoUnrecordedPendingChangesets();
  await assertMainBranch(options, { allowDryRunBypass: !options.recoverVersion });

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

function parseOptions(args) {
  const parsed = {
    dryRun: false,
    skipContainer: false,
    recoverVersion: "",
    base: "",
    push: false,
    tags: [],
    platforms: [],
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
      case "--push":
        parsed.push = true;
        break;
      case "--tag": {
        const tag = args[++index] ?? "";
        if (!tag) usage("--tag requires a value");
        parsed.tags.push(tag);
        break;
      }
      case "--platform": {
        const platform = args[++index] ?? "";
        if (!platform) usage("--platform requires a value");
        parsed.platforms.push(parsePlatform(platform));
        break;
      }
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

export async function assertNoUnrecordedPendingChangesets(root = repoRoot) {
  const pending = await readReleaseChangesets(root);
  const prereleaseChangesetIds = await readPrereleaseChangesetIds(root);
  const unrecorded = findUnrecordedPendingChangesets(pending, prereleaseChangesetIds);
  if (unrecorded.length > 0) {
    throw new Error(
      `release publish requires all pending changesets to be recorded in .changeset/pre.json: ${unrecorded.join(", ")}`,
    );
  }
}

export function releasePublishEnv(overrides = {}) {
  return { ...process.env, ...overrides, ZITADEL_TELEMETRY_BUILD_CHANNEL: "production" };
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
  console.log(`usage: node scripts/release.mjs <version|pack|snapshot|image|publish|verify> [options]

Options:
  --dry-run          Do not publish or mutate remote registries.
  --skip-container   Build release files without building a local Docker image.
  --recover-version <v>
                     Publish recovery target version from release-publish.
  --base <ref>       Base ref for release publish detection.

image options:
  --push             Push the image instead of loading it into the local daemon.
  --tag <tag>        Tag to apply (repeatable; "<tag>" or "<image>:<tag>").
                     Default: ghcr.io/zitadel/nextgen:sha-<commit>.
  --platform <os/arch>
                     Platform to build (repeatable). Default: linux/amd64.
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
