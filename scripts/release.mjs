#!/usr/bin/env node
import { stat } from "node:fs/promises";
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
  hostLinuxPlatform,
  packPublicPackages,
  prepareDockerContext,
  readServerRelease,
  releaseDir,
  stageServerNpmBinaries,
  verifyArchiveChecksums,
  verifyLocalArtifacts,
  writeReleaseMetadata,
} from "./release-artifacts.mjs";
import {
  planSkipMessage,
  readPublishPlan,
  readPublishPlanIfExists,
  writePublishPlan,
} from "./release-plan.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export async function main(args = forwardedArgs()) {
  const command = args[0];
  const options = parseOptions(args.slice(1));

  switch (command) {
    case "version":
      return await commandVersion();
    case "build":
      return await commandBuild();
    case "snapshot":
      return await commandSnapshot(options);
    case "pack":
      return await commandPack();
    case "gate":
      return await commandGate(options);
    case "rehearse-plan":
      return await commandRehearsePlan();
    case "verify":
      return await commandVerify();
    case "publish-container":
      return await commandPublishContainer();
    case "publish-github":
      return await commandPublishGithub();
    case "publish-tags":
      return await commandPublishTags();
    default:
      usage(command ? `unknown release command: ${command}` : undefined);
  }
}

async function commandVersion() {
  const release = await readServerRelease(repoRoot);
  console.log(`${release.name} ${release.version} (${release.tag})`);
}

// Builds every promotable release artifact except container images: binaries
// for all platforms, npm-staged binaries, archives with checksums, public
// package tarballs, the docker build context, and release metadata. This is
// the only step that compiles; everything publish-side promotes its output.
async function commandBuild() {
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
  await verifyLocalArtifacts({ repoRoot, outDir, release });
  console.log(`release artifacts ready: ${outDir}`);
}

// Local convenience on top of release:build (a Moon task dep): loads a
// host-platform container image for local runs. CI and publish never use it.
async function commandSnapshot(options) {
  const release = await readServerRelease(repoRoot);
  const outDir = releaseDir(repoRoot, release.version);
  await verifyLocalArtifacts({ repoRoot, outDir, release });

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

  console.log(`release snapshot ready: ${outDir}`);
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

// Evaluates whether this checkout should publish and records the decision in
// the publish plan. All publish-side tasks read the plan and no-op on a skip,
// which is how a Moon task graph carries a runtime gate decision.
async function commandGate(options) {
  const release = await readServerRelease(repoRoot);
  const dryRun = options.dryRun || isEnvFlag(process.env.ZITADEL_RELEASE_DRY_RUN);
  const recoverVersion = options.recoverVersion || process.env.RECOVER_VERSION || "";
  const base = options.base || process.env.BASE_SHA || "HEAD^";

  let decision;
  if (recoverVersion) {
    assertRecoverVersion(release, recoverVersion);
    decision = { shouldPublish: true, reason: `manual recovery for ${recoverVersion}` };
  } else {
    const preflight = await detectReleaseAutomation({ repoRoot, mode: "publish", base });
    decision = resolvePublishGate({ dryRun, recoverVersion, preflight, release });
  }

  if (decision.shouldPublish) {
    await assertNoUnrecordedPendingChangesets();
    await assertMainBranch({ dryRun, recoverVersion }, { allowDryRunBypass: !recoverVersion });
  }

  const plan = await writePublishPlan(repoRoot, {
    shouldPublish: decision.shouldPublish,
    dryRun,
    reason: decision.reason,
    version: release.version,
    tag: release.tag,
    prerelease: release.prerelease,
    recoverVersion,
  });
  console.log(
    `release gate: ${plan.shouldPublish ? (plan.dryRun ? "publish (dry run)" : "publish") : "skip"}` +
      ` - ${plan.reason}`,
  );
}

// PR rehearsals run the publish surfaces without the gate: gating conditions
// (version commit, recorded changesets, main branch) are meaningless on a
// feature branch and would fail any PR that adds a changeset. The plan is
// always dry, so no surface can mutate anything remote.
async function commandRehearsePlan() {
  const release = await readServerRelease(repoRoot);
  const plan = await writePublishPlan(repoRoot, {
    shouldPublish: true,
    dryRun: true,
    reason: "release rehearsal (gate-free dry run)",
    version: release.version,
    tag: release.tag,
    prerelease: release.prerelease,
    recoverVersion: "",
  });
  console.log(`release rehearse-plan: dry-run plan written for ${plan.version}`);
}

export function resolvePublishGate({ dryRun = false, recoverVersion = "", preflight, release, env = process.env }) {
  if (recoverVersion) {
    return { shouldPublish: true, reason: `manual recovery for ${recoverVersion}` };
  }
  if (!preflight.ok) {
    throw new Error(
      [
        `release publish preflight failed: ${preflight.reason}`,
        ...preflight.errors.map((error) => `- ${error}`),
      ].join("\n"),
    );
  }
  if (!preflight.shouldRun) {
    if (shouldFailManualPublishSkip({ dryRun, recoverVersion }, env)) {
      throw new Error(
        [
          `release publish: skip - ${preflight.reason}`,
          "manual release dispatch would not publish anything; " +
            `pass recover_version=${release.version} to recover this checked-out version, ` +
            "or run from a Changesets version package commit.",
        ].join("\n"),
      );
    }
    return { shouldPublish: false, reason: preflight.reason };
  }
  return { shouldPublish: true, reason: preflight.reason };
}

async function commandVerify() {
  const release = await readServerRelease(repoRoot);
  const outDir = releaseDir(repoRoot, release.version);
  const plan = await readPublishPlanIfExists(repoRoot);
  if (plan && !plan.shouldPublish) {
    console.log(planSkipMessage("verify-artifacts", plan));
    return;
  }
  if (plan) {
    assertPlanVersion(plan, release);
  }
  await verifyLocalArtifacts({ repoRoot, release, outDir });
  await verifyArchiveChecksums({ outDir });
  await run("node", ["apps/cli-journey-e2e/scripts/verify-tarballs.mjs", join(outDir, "npm")], {
    cwd: repoRoot,
  });
  console.log(`release artifacts verified for ${release.version}`);
}

async function commandPublishContainer() {
  const release = await readServerRelease(repoRoot);
  const plan = await readPublishPlan(repoRoot);
  if (!plan.shouldPublish) {
    console.log(planSkipMessage("publish-container", plan));
    return;
  }
  assertPlanVersion(plan, release);

  const outDir = releaseDir(repoRoot, release.version);
  const contextDir = join(outDir, "docker-context");
  if (!(await exists(join(contextDir, "Dockerfile")))) {
    throw new Error(
      `missing docker context at ${contextDir}; run moon run release:build first`,
    );
  }

  const result = await buildContainerImage({
    repoRoot,
    outDir,
    release,
    contextDir,
    dryRun: plan.dryRun,
    push: true,
    platforms: CONTAINER_PLATFORMS,
  });
  if (plan.dryRun) {
    console.log(`release publish-container: dry run - would run docker ${result.args.join(" ")}`);
    return;
  }
  console.log(`release publish-container: pushed ${result.tags.join(", ")}`);
}

async function commandPublishGithub() {
  const release = await readServerRelease(repoRoot);
  const plan = await readPublishPlan(repoRoot);
  if (!plan.shouldPublish) {
    console.log(planSkipMessage("publish-github", plan));
    return;
  }
  assertPlanVersion(plan, release);
  const outDir = releaseDir(repoRoot, release.version);
  await upsertProductGithubRelease({ repoRoot, outDir, dryRun: plan.dryRun, log: console.log });
}

// `changeset publish` used to create per-package git tags locally on the
// runner, where they were discarded. `changeset tag` recreates the same tags
// for the checked-out versions (skipping ones that already exist locally), so
// pushing after it converges the remote tag surface on every publish run.
async function commandPublishTags() {
  const release = await readServerRelease(repoRoot);
  const plan = await readPublishPlan(repoRoot);
  if (!plan.shouldPublish) {
    console.log(planSkipMessage("publish-tags", plan));
    return;
  }
  assertPlanVersion(plan, release);
  if (plan.dryRun) {
    console.log("release publish-tags: dry run - would run changeset tag and push tags to origin");
    return;
  }
  await run("corepack", ["pnpm", "exec", "changeset", "tag"], { cwd: repoRoot });
  await run("git", ["push", "origin", "--tags"], { cwd: repoRoot });
  console.log("release publish-tags: git tags pushed");
}

function assertRecoverVersion(release, recoverVersion) {
  if (release.version !== recoverVersion) {
    throw new Error(
      `release publish recovery requires checked-out server version ${recoverVersion}, got ${release.version}`,
    );
  }
}

function assertPlanVersion(plan, release) {
  if (plan.version !== release.version) {
    throw new Error(
      `publish plan version ${plan.version} does not match checked-out server version ${release.version}; ` +
        "re-run the release gate on this checkout",
    );
  }
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

export function shouldFailManualPublishSkip(options = {}, env = process.env) {
  return env.GITHUB_EVENT_NAME === "workflow_dispatch" && !options.dryRun && !options.recoverVersion;
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

function isEnvFlag(value) {
  return value === "1" || value === "true";
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function usage(error) {
  if (error) {
    console.error(error);
    console.error("");
  }
  console.log(`usage: node scripts/release.mjs <command> [options]

Build commands:
  version            Print the release name, version, and tag.
  build              Build all release artifacts except container images.
  snapshot           Load a host-platform container image from built artifacts.
  pack               Build binaries and npm tarballs only.

Publish commands (read the publish plan written by gate):
  gate               Evaluate publish preconditions and write the publish plan.
  rehearse-plan      Write a gate-free dry-run plan for PR rehearsals.
  verify             Verify built artifacts, archive checksums, and tarballs.
  publish-container  Push the multi-arch container image (dry run per plan).
  publish-github     Create or update the draft GitHub Release.
  publish-tags       Create Changesets git tags and push them to origin.

npm publishing lives in scripts/release-npm.mjs (release:publish-npm task).

Options:
  --dry-run          Gate only: record a dry-run plan (no remote mutations).
  --skip-container   Snapshot only: verify artifacts without a local image.
  --recover-version <v>
                     Gate only: manual recovery target version.
  --base <ref>       Gate only: base ref for release publish detection.

Environment fallbacks for gate: ZITADEL_RELEASE_DRY_RUN, RECOVER_VERSION, BASE_SHA.
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
