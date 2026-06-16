#!/usr/bin/env node
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { forwardedArgs, isDirectRun, run, runCapture } from "./dev-process.mjs";
import {
  findUnrecordedPendingChangesets,
  readPendingChangesets,
  readPrereleaseChangesetIds,
} from "./release-automation.mjs";
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
    case "recover":
      return await commandRecover(options);
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

  await run("corepack", ["pnpm", "install", "--frozen-lockfile"], { cwd: repoRoot });
  await run("sh", ["scripts/sync-embedded-ui-dist.sh", "all"], { cwd: repoRoot });
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

async function commandPack() {
  const release = await readServerRelease(repoRoot);
  const outDir = releaseDir(repoRoot, release.version);
  const info = await gitInfo({ repoRoot });
  await run("sh", ["scripts/sync-embedded-ui-dist.sh", "all"], { cwd: repoRoot });
  await run("go", ["mod", "download"], { cwd: repoRoot });
  await buildServerBinaries({ repoRoot, outDir, version: release.version, gitInfo: info });
  await stageServerNpmBinaries({ repoRoot, outDir, version: release.version });
  await packPublicPackages({ repoRoot, outDir, version: release.version });
  console.log(`npm tarballs ready: ${join(outDir, "npm")}`);
}

async function commandPublish(options) {
  const release = await readServerRelease(repoRoot);
  const outDir = releaseDir(repoRoot, release.version);
  await assertNoUnrecordedPendingChangesets();
  await assertMainBranch(options);

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
    console.log("dry run: would publish npm packages, push product tag, push container images, and update GitHub Release");
    return;
  }

  await commandSnapshot({ skipContainer: true });
  await ensureProductTag(release);
  await run("corepack", ["pnpm", "exec", "changeset", "publish"], { cwd: repoRoot });
  await buildContainerImage({ repoRoot, outDir, release, push: true, platforms: CONTAINER_PLATFORMS });
  await upsertGitHubRelease(release, outDir);
  await commandVerify();
}

async function commandRecover(options) {
  if (!options.version) {
    usage("--version is required for recover");
  }
  const release = await readServerRelease(repoRoot);
  if (release.version !== options.version) {
    throw new Error(
      `checked out server release version is ${release.version}, expected ${options.version}`,
    );
  }
  await verifyLocalArtifacts({ repoRoot, release, outDir: releaseDir(repoRoot, release.version) });
  if (!options.dryRun) {
    await buildContainerImage({
      repoRoot,
      release,
      outDir: releaseDir(repoRoot, release.version),
      push: true,
      platforms: CONTAINER_PLATFORMS,
    });
    await upsertGitHubRelease(release, releaseDir(repoRoot, release.version));
  }
}

async function commandVerify() {
  const release = await readServerRelease(repoRoot);
  await verifyLocalArtifacts({ repoRoot, release, outDir: releaseDir(repoRoot, release.version) });
  await assertProductTagPointsAtHead(release);
  console.log(`release artifacts verified for ${release.version}`);
}

function parseOptions(args) {
  const parsed = { dryRun: false, skipContainer: false, version: "" };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--dry-run":
        parsed.dryRun = true;
        break;
      case "--skip-container":
        parsed.skipContainer = true;
        break;
      case "--version":
        parsed.version = args[++index] ?? "";
        if (!parsed.version) usage("--version requires a value");
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

export async function assertNoUnrecordedPendingChangesets(root = repoRoot) {
  const pending = await readPendingChangesets(root);
  const prereleaseChangesetIds = await readPrereleaseChangesetIds(root);
  const unrecorded = findUnrecordedPendingChangesets(pending, prereleaseChangesetIds);
  if (unrecorded.length > 0) {
    throw new Error(
      `release publish requires all pending changesets to be recorded in .changeset/pre.json: ${unrecorded.join(", ")}`,
    );
  }
}

async function assertMainBranch(options) {
  if (options.dryRun || process.env.GITHUB_REF === "refs/heads/main") {
    return;
  }
  const branch = (await runCapture("git", ["branch", "--show-current"], { cwd: repoRoot })).stdout.trim();
  if (branch !== "main") {
    throw new Error(`release publish must run from main, got ${branch || "detached HEAD"}`);
  }
}

async function ensureProductTag(release) {
  const head = (await runCapture("git", ["rev-parse", "HEAD"], { cwd: repoRoot })).stdout.trim();
  let existing = "";
  try {
    existing = (await runCapture("git", ["rev-list", "-n", "1", release.tag], { cwd: repoRoot })).stdout.trim();
  } catch {
    await run("git", ["tag", "-a", release.tag, "-m", `ZITADEL ${release.version}`], { cwd: repoRoot });
    await run("git", ["push", "origin", release.tag], { cwd: repoRoot });
    return;
  }
  if (existing !== head) {
    throw new Error(`${release.tag} points at ${existing}, expected ${head}`);
  }
  await run("git", ["push", "origin", release.tag], { cwd: repoRoot });
}

async function assertProductTagPointsAtHead(release) {
  const head = (await runCapture("git", ["rev-parse", "HEAD"], { cwd: repoRoot })).stdout.trim();
  const tagCommit = (await runCapture("git", ["rev-list", "-n", "1", release.tag], { cwd: repoRoot })).stdout.trim();
  if (tagCommit !== head) {
    throw new Error(`${release.tag} points at ${tagCommit}, expected ${head}`);
  }
}

async function upsertGitHubRelease(release, outDir) {
  const notes = join(outDir, "release-notes.md");
  const archivesDir = join(outDir, "archives");
  const archiveFiles = (await readdir(archivesDir))
    .filter((name) => name !== ".DS_Store")
    .map((name) => join(archivesDir, name));
  if (archiveFiles.length === 0) {
    throw new Error(`no release archives found in ${archivesDir}`);
  }
  const prereleaseArgs = release.prerelease ? ["--prerelease"] : ["--latest"];
  const commonArgs = [
    release.tag,
    "--title",
    `ZITADEL ${release.version}`,
    "--notes-file",
    notes,
    "--draft",
    ...prereleaseArgs,
  ];
  const exists = await ghReleaseExists(release.tag);
  if (exists) {
    await run("gh", ["release", "edit", ...commonArgs], { cwd: repoRoot });
    await run("gh", ["release", "upload", release.tag, ...archiveFiles, "--clobber"], { cwd: repoRoot });
    return;
  }
  await run("gh", ["release", "create", ...commonArgs, ...archiveFiles], { cwd: repoRoot });
}

async function ghReleaseExists(tag) {
  try {
    await runCapture("gh", ["release", "view", tag, "--json", "tagName"], { cwd: repoRoot });
    return true;
  } catch {
    return false;
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
  console.log(`usage: node scripts/release.mjs <version|pack|snapshot|publish|recover|verify> [options]

Options:
  --dry-run          Do not publish or mutate remote registries.
  --skip-container   Build release files without building a local Docker image.
  --version <v>      Recovery target version.
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
