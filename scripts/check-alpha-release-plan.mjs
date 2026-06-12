#!/usr/bin/env node
import { readFile as readFileDefault } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  PUBLIC_PACKAGE_NAMES,
  validateAlphaVersion,
  validateChangesetsFixedGroup,
} from "./release-alpha-train.mjs";

export async function checkAlphaReleasePlan(options) {
  const cwd = options.cwd ?? process.cwd();
  const readFileFn = options.readFile ?? readFileDefault;
  const statusPath = requiredString(options.statusPath, "statusPath");

  const changesetsConfig = JSON.parse(
    await readFileFn(join(cwd, ".changeset/config.json"), "utf8"),
  );
  validateChangesetsFixedGroup(changesetsConfig);

  const status = JSON.parse(await readFileFn(statusPath, "utf8"));
  const releaseVersion = validateChangesetsStatus(status);
  await validateReleaseTooling(cwd, readFileFn);

  return { releaseVersion };
}

export function validateChangesetsStatus(status) {
  const releases = Array.isArray(status.releases) ? status.releases : [];
  const releaseByName = new Map(
    releases
      .filter((release) => release && typeof release === "object")
      .map((release) => [release.name, release]),
  );
  const plannedPublicReleases = PUBLIC_PACKAGE_NAMES.filter((name) => {
    const release = releaseByName.get(name);
    return release && release.type !== "none";
  });

  if (plannedPublicReleases.length === 0) {
    return undefined;
  }

  const missing = PUBLIC_PACKAGE_NAMES.filter((name) => {
    const release = releaseByName.get(name);
    return !release || release.type === "none";
  });
  if (missing.length > 0) {
    throw new Error(`alpha train is missing public packages: ${missing.join(", ")}`);
  }

  const versions = new Set();
  for (const name of PUBLIC_PACKAGE_NAMES) {
    const version = releaseByName.get(name).newVersion;
    if (typeof version !== "string" || version.length === 0) {
      throw new Error(`alpha train release for ${name} has no newVersion`);
    }
    versions.add(version);
  }

  if (versions.size !== 1) {
    throw new Error(
      `alpha train versions must be lockstep: ${PUBLIC_PACKAGE_NAMES.map((name) => {
        const release = releaseByName.get(name);
        return `${name}@${release.newVersion}`;
      }).join(", ")}`,
    );
  }

  const version = [...versions][0];
  validateAlphaVersion(version);
  return version;
}

export async function validateReleaseTooling(cwd, readFileFn = readFileDefault) {
  const goreleaser = await readFileFn(join(cwd, ".goreleaser.yaml"), "utf8");
  assertPattern(
    goreleaser,
    /eq\s+\.Prerelease\s+""/,
    "GoReleaser Docker latest tag must be gated on stable releases only",
  );
  assertPattern(
    goreleaser,
    /prerelease:\s*auto/,
    "GoReleaser releases must mark prereleases automatically",
  );
  assertPattern(
    goreleaser,
    /make_latest:\s*'{{ if \.Prerelease }}false{{ else }}true{{ end }}'/,
    "GoReleaser prereleases must not become GitHub latest",
  );

  const legacyReleaseWorkflow = await readOptionalFile(
    join(cwd, ".github/workflows/release-npm.yml"),
    readFileFn,
  );
  if (legacyReleaseWorkflow !== undefined) {
    throw new Error("release publishing must live in ci.yml, not release-npm.yml");
  }

  const ciWorkflow = await readFileFn(join(cwd, ".github/workflows/ci.yml"), "utf8");
  assertContains(
    ciWorkflow,
    "cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
    "ci.yml must not cancel main release runs",
  );
  assertNotContains(
    ciWorkflow,
    "    paths:",
    "ci.yml must not path-filter main pushes before release relevance is computed",
  );
  assertContains(
    ciWorkflow,
    "detect-alpha-release:",
    "ci.yml must compute release relevance before publishing",
  );
  assertContains(
    ciWorkflow,
    "should_release: ${{ steps.detect.outputs.should_release }}",
    "detect-alpha-release must expose a should_release output",
  );
  assertContains(
    ciWorkflow,
    'import { PUBLIC_PACKAGE_MANIFESTS } from "./scripts/release-alpha-train.mjs";',
    "detect-alpha-release must derive public package release paths from release-alpha-train.mjs",
  );
  assertContains(
    ciWorkflow,
    'path.startsWith(".changeset/") || publicPackageReleasePaths.has(path)',
    "detect-alpha-release must detect Changesets and public package release files",
  );
  assertContains(
    ciWorkflow,
    "ci-success:",
    "ci.yml must include an aggregate CI success gate",
  );
  assertContains(
    ciWorkflow,
    'const allowedSkipped = new Set(["changeset-check"]);',
    "ci-success must only allow intentionally skipped jobs",
  );
  assertContains(
    ciWorkflow,
    "release-alpha-train:",
    "ci.yml must contain the alpha release train job",
  );
  assertJobContains(
    ciWorkflow,
    "release-alpha-train",
    "    if: always() && github.event_name == 'push' && github.ref == 'refs/heads/main' && needs.detect-alpha-release.result == 'success' && needs.ci-success.result == 'success' && needs.detect-alpha-release.outputs.should_release == 'true'",
    "release-alpha-train must explicitly require release relevance and a successful CI gate",
  );
  assertContains(
    ciWorkflow,
    "needs: [detect-alpha-release, ci-success]",
    "release-alpha-train must wait for release relevance detection and the aggregate CI gate",
  );
  assertContains(
    ciWorkflow,
    [
      "    permissions:",
      "      contents: write",
      "      pull-requests: write",
      "      packages: write",
      "      id-token: write",
    ].join("\n"),
    "release-alpha-train must scope publish permissions to the release job",
  );
  assertNotContains(
    ciWorkflow,
    "gh run list --workflow ci.yml",
    "release-alpha-train must rely on ci.yml needs instead of polling GitHub Actions",
  );
  assertContains(
    ciWorkflow,
    "createGithubReleases: false",
    "Changesets must not create package-shaped GitHub Releases",
  );
  assertContains(
    ciWorkflow,
    "node scripts/release-alpha-train.mjs status --published \"$PUBLISHED\" --remote false",
    "ci.yml must inspect alpha train recovery status without remote checks",
  );
  assertContains(
    ciWorkflow,
    "steps.alpha-status.outputs.should_complete == 'true'",
    "ci.yml must complete recoverable alpha trains even when npm publish is not rerun",
  );
  assertContains(
    ciWorkflow,
    "node scripts/release-alpha-train.mjs prepare --published \"$PUBLISHED\"",
    "ci.yml must prepare the alpha train before GoReleaser",
  );
  assertContains(
    ciWorkflow,
    '--out-dir "$RUNNER_TEMP/alpha-release"',
    "ci.yml must write alpha release notes outside the checkout before GoReleaser --clean",
  );
  assertContains(
    ciWorkflow,
    'alpha_env="$RUNNER_TEMP/alpha-release.env"',
    "ci.yml must write alpha release outputs outside the checkout before GoReleaser --clean",
  );
  assertContains(
    ciWorkflow,
    "steps.alpha.outputs.create_tag == 'true'",
    "ci.yml must create the Go tag only when the alpha train needs it",
  );
  assertContains(
    ciWorkflow,
    "steps.alpha.outputs.run_goreleaser == 'true'",
    "ci.yml must skip GoReleaser when the alpha release and image already exist",
  );
  assertNotContains(
    ciWorkflow,
    "if: ${{ steps.changesets.outputs.published == 'true' }}",
    "post-npm alpha train steps must not be gated only on Changesets publishing in the current rerun",
  );
  assertContains(
    ciWorkflow,
    "--prerelease",
    "alpha GitHub Releases must be marked as prereleases",
  );
  assertContains(
    ciWorkflow,
    "--latest=false",
    "alpha GitHub Releases must not become GitHub latest",
  );
}

function assertContains(input, expected, message) {
  if (!input.includes(expected)) {
    throw new Error(message);
  }
}

function assertJobContains(input, jobName, expected, message) {
  const block = workflowJobBlock(input, jobName);
  if (!block || !block.includes(expected)) {
    throw new Error(message);
  }
}

function workflowJobBlock(input, jobName) {
  const headerPattern = new RegExp(`^  ${escapeRegExp(jobName)}:\\s*$`, "m");
  const header = headerPattern.exec(input);
  if (!header) {
    return undefined;
  }

  const nextJobPattern = /^ {2}[A-Za-z0-9_-]+:\s*$/gm;
  nextJobPattern.lastIndex = header.index + header[0].length;
  const nextJob = nextJobPattern.exec(input);
  const end = nextJob ? nextJob.index : input.length;
  return input.slice(header.index, end);
}

function escapeRegExp(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertNotContains(input, expected, message) {
  if (input.includes(expected)) {
    throw new Error(message);
  }
}

function assertPattern(input, pattern, message) {
  if (!pattern.test(input)) {
    throw new Error(message);
  }
}

async function readOptionalFile(path, readFileFn) {
  try {
    return await readFileFn(path, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function isDirectRun(url) {
  return process.argv[1] && url === pathToFileURL(process.argv[1]).href;
}

if (isDirectRun(import.meta.url)) {
  try {
    const result = await checkAlphaReleasePlan({ statusPath: process.argv[2] });
    if (result.releaseVersion) {
      console.log(`alpha release plan ok: ${result.releaseVersion}`);
    } else {
      console.log("alpha release plan ok: no public package release planned");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
