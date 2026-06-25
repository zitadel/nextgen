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
const PUBLIC_PACKAGE_BUILD_TARGETS = [
  "cli:build",
  "api:build",
  "components:build",
  "sdk-core:build",
  "sdk-next:build",
  "sdk-nuxt:build",
  "sdk-react:build",
  "sdk-vue:build",
  "sdk-angular:build",
  "sdk-solid:build",
  "sdk-svelte:build",
  "sdk-qwik:build",
  "sdk-sveltekit:build",
  "sdk-tanstack-start:build",
  "sdk-solid-start:build",
  "sdk-qwik-city:build",
];

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
  await buildEmbeddedUI();
  await buildPublicPackageArtifacts();
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
  await buildEmbeddedUI();
  await buildPublicPackageArtifacts();
  await run("go", ["mod", "download"], { cwd: repoRoot });
  await buildServerBinaries({ repoRoot, outDir, version: release.version, gitInfo: info });
  await stageServerNpmBinaries({ repoRoot, outDir, version: release.version });
  await packPublicPackages({ repoRoot, outDir, version: release.version });
  console.log(`npm tarballs ready: ${join(outDir, "npm")}`);
}

async function buildEmbeddedUI() {
  await run("moon", ["run", "console:build", "login-ui:build"], { cwd: repoRoot });
}

/**
 * Build the public npm package artifacts for a release. Sets
 * `ZITADEL_TELEMETRY_BUILD_CHANNEL=production` so the published CLI bundle is
 * stamped for the production Mixpanel project; only the release pipeline sets
 * this, so contributor/CI builds default to the dev project (see
 * `apps/cli/tsdown.config.ts`).
 */
async function buildPublicPackageArtifacts() {
  await run("moon", ["run", ...PUBLIC_PACKAGE_BUILD_TARGETS], {
    cwd: repoRoot,
    env: { ...process.env, ZITADEL_TELEMETRY_BUILD_CHANNEL: "production" },
  });
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
      console.log(`release publish: skip - ${preflight.reason}`);
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
    console.log("dry run: would publish npm packages, push container images, and update the draft GitHub Release");
    return;
  }

  await commandSnapshot({ skipContainer: true });
  await run("corepack", ["pnpm", "exec", "changeset", "publish"], { cwd: repoRoot });
  await buildContainerImage({ repoRoot, outDir, release, push: true, platforms: CONTAINER_PLATFORMS });
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
  const parsed = { dryRun: false, skipContainer: false, recoverVersion: "", base: "" };
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

async function assertMainBranch(options, { allowDryRunBypass = true } = {}) {
  if ((allowDryRunBypass && options.dryRun) || process.env.GITHUB_REF === "refs/heads/main") {
    return;
  }
  const branch = (await runCapture("git", ["branch", "--show-current"], { cwd: repoRoot })).stdout.trim();
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
  console.log(`usage: node scripts/release.mjs <version|pack|snapshot|publish|verify> [options]

Options:
  --dry-run          Do not publish or mutate remote registries.
  --skip-container   Build release files without building a local Docker image.
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
