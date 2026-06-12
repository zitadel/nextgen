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

  const releaseWorkflow = await readFileFn(join(cwd, ".github/workflows/release-npm.yml"), "utf8");
  assertContains(
    releaseWorkflow,
    "createGithubReleases: false",
    "Changesets must not create package-shaped GitHub Releases",
  );
  assertContains(
    releaseWorkflow,
    "node scripts/release-alpha-train.mjs status --published \"$PUBLISHED\" --remote false",
    "release-npm.yml must inspect alpha train recovery status without remote checks",
  );
  assertContains(
    releaseWorkflow,
    "steps.alpha-status.outputs.should_complete == 'true'",
    "release-npm.yml must complete recoverable alpha trains even when npm publish is not rerun",
  );
  assertContains(
    releaseWorkflow,
    "node scripts/release-alpha-train.mjs prepare --published \"$PUBLISHED\"",
    "release-npm.yml must prepare the alpha train before GoReleaser",
  );
  assertContains(
    releaseWorkflow,
    '--out-dir "$RUNNER_TEMP/alpha-release"',
    "release-npm.yml must write alpha release notes outside the checkout before GoReleaser --clean",
  );
  assertContains(
    releaseWorkflow,
    'alpha_env="$RUNNER_TEMP/alpha-release.env"',
    "release-npm.yml must write alpha release outputs outside the checkout before GoReleaser --clean",
  );
  assertContains(
    releaseWorkflow,
    "steps.alpha.outputs.create_tag == 'true'",
    "release-npm.yml must create the Go tag only when the alpha train needs it",
  );
  assertContains(
    releaseWorkflow,
    "steps.alpha.outputs.run_goreleaser == 'true'",
    "release-npm.yml must skip GoReleaser when the alpha release and image already exist",
  );
  assertNotContains(
    releaseWorkflow,
    "if: ${{ steps.changesets.outputs.published == 'true' }}",
    "post-npm alpha train steps must not be gated only on Changesets publishing in the current rerun",
  );
  assertContains(
    releaseWorkflow,
    "--prerelease",
    "alpha GitHub Releases must be marked as prereleases",
  );
  assertContains(
    releaseWorkflow,
    "--latest=false",
    "alpha GitHub Releases must not become GitHub latest",
  );
}

function assertContains(input, expected, message) {
  if (!input.includes(expected)) {
    throw new Error(message);
  }
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
