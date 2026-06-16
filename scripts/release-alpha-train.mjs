#!/usr/bin/env node
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export const PUBLIC_PACKAGE_MANIFESTS = [
  "apps/cli/package.json",
  "packages/api/package.json",
  "packages/components/package.json",
  "packages/sdk-core/package.json",
  "packages/sdk-next/package.json",
  "packages/sdk-nuxt/package.json",
  "packages/sdk-react/package.json",
  "packages/sdk-vue/package.json",
  "packages/sdk-angular/package.json",
];

export const PUBLIC_PACKAGE_NAMES = [
  "@zitadel/cli",
  "@zitadel/api",
  "@zitadel/components",
  "@zitadel/sdk-core",
  "@zitadel/sdk-next",
  "@zitadel/sdk-nuxt",
  "@zitadel/sdk-react",
  "@zitadel/sdk-vue",
  "@zitadel/sdk-angular",
];

export const SERVER_IMAGE_NAME = "ghcr.io/zitadel/nextgen";

const ALPHA_VERSION_RE = /^\d+\.\d+\.\d+-alpha\.\d+$/;
const DEFAULT_NPM_TRAIN_LOOKUP_ATTEMPTS_AFTER_PUBLISH = 12;
const DEFAULT_NPM_TRAIN_LOOKUP_DELAY_MS = 10_000;

export async function prepareAlphaReleaseTrain(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const readFileFn = options.readFile ?? readFile;
  const writeFileFn = options.writeFile ?? writeFile;
  const mkdirFn = options.mkdir ?? mkdir;
  const execFileFn = options.execFile ?? execFile;
  const outDir = options.outDir ?? join(cwd, "dist/alpha-release");

  const state = await inspectAlphaReleaseTrain({
    cwd,
    execFile: execFileFn,
    readFile: readFileFn,
    readdir: options.readdir ?? readdir,
    published: options.published,
    remote: options.remote,
  });
  if (state.skipReason) {
    throw new Error(`alpha release train is not ready to complete: ${state.skipReason}`);
  }

  const { image, packages, tagName, title, version } = state;
  const notes = renderAlphaReleaseNotes({ title, version, image, packages });
  await mkdirFn(outDir, { recursive: true });
  const notesPath = join(outDir, `zitadel-alpha-${version}-notes.md`);
  await writeFileFn(notesPath, notes);

  return {
    version,
    tagName,
    title,
    image,
    notesPath,
    packages,
    shouldComplete: state.shouldComplete,
    shouldCreateTag: state.shouldCreateTag,
    shouldRunGoreleaser: state.shouldRunGoreleaser,
    shouldUpdateRelease: state.shouldUpdateRelease,
    tagExists: state.tagExists,
    releaseExists: state.releaseExists,
    imageExists: state.imageExists,
    npmTrainExists: state.npmTrainExists,
  };
}

export async function inspectAlphaReleaseTrain(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const readFileFn = options.readFile ?? readFile;
  const readdirFn = options.readdir ?? readdir;
  const execFileFn = options.execFile ?? execFile;
  const publishedWasSpecified = options.published !== undefined;
  const published = publishedWasSpecified ? normalizeBoolean(options.published) : undefined;
  const remote = options.remote === undefined ? true : normalizeBoolean(options.remote);

  const packages = await readPublicPackageManifests(cwd, readFileFn);
  const config = JSON.parse(await readFileFn(join(cwd, ".changeset/config.json"), "utf8"));
  validateChangesetsFixedGroup(config);

  const versions = new Set(packages.map((pkg) => pkg.version));
  if (versions.size !== 1) {
    throw new Error(
      `public package versions must be lockstep: ${packages
        .map((pkg) => `${pkg.name}@${pkg.version}`)
        .join(", ")}`,
    );
  }

  const version = [...versions][0];
  validateAlphaVersion(version);
  const tagName = `v${version}`;
  const image = `${SERVER_IMAGE_NAME}:${version}`;
  const title = `ZITADEL Alpha ${version}`;
  const activeChangesets = await activeChangesetFiles(cwd, {
    readFile: readFileFn,
    readdir: readdirFn,
  });
  const headCommit = await gitOutput(execFileFn, cwd, ["rev-parse", "HEAD"]);
  const tagCommit = await tagCommitFor(tagName, execFileFn, cwd);
  const tagExists = Boolean(tagCommit);
  const tagMatchesHead = tagCommit === headCommit;

  if (activeChangesets.length > 0) {
    return {
      version,
      tagName,
      title,
      image,
      packages,
      activeChangesets,
      headCommit,
      tagCommit,
      tagExists,
      tagMatchesHead,
      releaseExists: false,
      imageExists: false,
      shouldComplete: false,
      shouldCreateTag: false,
      shouldRunGoreleaser: false,
      shouldUpdateRelease: false,
      skipReason: `pending changesets: ${activeChangesets.join(", ")}`,
    };
  }

  const shouldVerifyNpmTrain = publishedWasSpecified;
  const npmTrain = shouldVerifyNpmTrain
    ? await publicNpmPackageTrainStatus(packages, execFileFn, cwd, {
        attempts:
          published === true
            ? (options.npmLookupAttempts ?? DEFAULT_NPM_TRAIN_LOOKUP_ATTEMPTS_AFTER_PUBLISH)
            : 1,
        delayMs: options.npmLookupDelayMs ?? DEFAULT_NPM_TRAIN_LOOKUP_DELAY_MS,
        sleep: options.sleep ?? sleep,
      })
    : undefined;
  const npmTrainExists = npmTrain?.exists;
  if (shouldVerifyNpmTrain && !npmTrainExists) {
    if (published === true) {
      throw new Error(
        `npm train ${version} did not become visible after ${npmTrain.attempts} ${pluralize(
          "attempt",
          npmTrain.attempts,
        )}: missing ${npmTrain.missing.join(", ")}`,
      );
    }
    return {
      version,
      tagName,
      title,
      image,
      packages,
      activeChangesets,
      headCommit,
      tagCommit,
      tagExists,
      tagMatchesHead,
      releaseExists: false,
      imageExists: false,
      shouldComplete: false,
      shouldCreateTag: false,
      shouldRunGoreleaser: false,
      shouldUpdateRelease: false,
      npmTrainExists,
      skipReason: "npm train is not published",
    };
  }

  const releaseExists = remote ? await githubReleaseExists(tagName, execFileFn, cwd) : false;
  const imageExists = remote ? await containerImageExists(image, execFileFn, cwd) : false;
  const shouldRunGoreleaser = !(releaseExists && imageExists);
  return {
    version,
    tagName,
    title,
    image,
    packages,
    activeChangesets,
    headCommit,
    tagCommit,
    tagExists,
    tagMatchesHead,
    releaseExists,
    imageExists,
    shouldComplete: true,
    shouldCreateTag: !tagExists,
    shouldRunGoreleaser,
    shouldUpdateRelease: true,
    npmTrainExists,
    skipReason: "",
  };
}

export async function readPublicPackageManifests(cwd, readFileFn = readFile) {
  const packages = [];
  for (let index = 0; index < PUBLIC_PACKAGE_MANIFESTS.length; index += 1) {
    const path = PUBLIC_PACKAGE_MANIFESTS[index];
    const expectedName = PUBLIC_PACKAGE_NAMES[index];
    const manifest = JSON.parse(await readFileFn(join(cwd, path), "utf8"));
    if (manifest.name !== expectedName) {
      throw new Error(`${path} must be ${expectedName}`);
    }
    if (manifest.private === true) {
      throw new Error(`${expectedName} must not be private`);
    }
    if (typeof manifest.version !== "string" || manifest.version.length === 0) {
      throw new Error(`${expectedName} must have a version`);
    }
    packages.push({ name: manifest.name, version: manifest.version, path });
  }
  return packages;
}

export function validateChangesetsFixedGroup(config) {
  const expected = new Set(PUBLIC_PACKAGE_NAMES);
  const groups = Array.isArray(config.fixed) ? config.fixed : [];
  const group = groups.find((candidate) => {
    if (!Array.isArray(candidate)) {
      return false;
    }
    const names = new Set(candidate);
    return (
      names.size === expected.size &&
      [...expected].every((name) => names.has(name)) &&
      [...names].every((name) => expected.has(name))
    );
  });
  if (!group) {
    throw new Error("changesets fixed group must contain exactly the public alpha packages");
  }
}

export function validateAlphaVersion(version) {
  if (!ALPHA_VERSION_RE.test(version)) {
    throw new Error(`alpha release version must match x.y.z-alpha.N: ${version}`);
  }
}

export async function tagExists(tagName, execFileFn = execFile, cwd = process.cwd()) {
  return Boolean(await tagCommitFor(tagName, execFileFn, cwd));
}

export async function pruneEmptyChangesets(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const readFileFn = options.readFile ?? readFile;
  const readdirFn = options.readdir ?? readdir;
  const unlinkFn = options.unlink ?? unlink;

  const removed = [];
  const files = await changesetMarkdownFiles(cwd, readdirFn);
  for (const file of files) {
    const path = join(cwd, ".changeset", file);
    const content = await readFileFn(path, "utf8");
    if (!changesetHasReleaseBump(content)) {
      await unlinkFn(path);
      removed.push(file);
    }
  }

  return removed.sort();
}

export function renderAlphaReleaseNotes({ title, version, image, packages }) {
  const lines = [
    `# ${title}`,
    "",
    "This alpha release is a tested lockstep train across the server image, CLI, and public SDK packages.",
    "It is a GitHub prerelease and does not move the Docker `latest` tag.",
    "",
    "## Tester Commands",
    "",
    "Latest alpha stream:",
    "",
    "```sh",
    "npx @zitadel/cli@alpha doctor",
    "npx @zitadel/cli@alpha start",
    "npx @zitadel/cli@alpha setup --framework next --server local",
    "```",
    "",
    "Exact reproducible train:",
    "",
    "```sh",
    `npx @zitadel/cli@${version} doctor`,
    `npx @zitadel/cli@${version} start`,
    `npx @zitadel/cli@${version} setup --framework next --server local`,
    "```",
    "",
    "## Components",
    "",
    "| Kind | Name | Version | Reference |",
    "| --- | --- | --- | --- |",
    `| container | \`${SERVER_IMAGE_NAME}\` | \`${version}\` | \`${image}\` |`,
  ];
  for (const pkg of packages) {
    lines.push(`| npm | \`${pkg.name}\` | \`${pkg.version}\` | npm |`);
  }
  lines.push("");
  return lines.join("\n");
}

export function parseAlphaReleaseArgs(args) {
  const command = args[0];
  if (command !== "prepare" && command !== "status" && command !== "prune-empty-changesets") {
    throw new Error(
      "Usage: release-alpha-train.mjs <status|prepare|prune-empty-changesets> [--out-dir <path>] [--published <true|false>]",
    );
  }
  const values = {};
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument ${arg}`);
    }
    const key = camelCase(arg.slice(2));
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    values[key] = value;
    index += 1;
  }
  return { command, values };
}

function camelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

async function activeChangesetFiles(cwd, options = {}) {
  const readFileFn = options.readFile ?? readFile;
  const readdirFn = options.readdir ?? readdir;
  const prereleaseChangesets = await prereleaseTrackedChangesets(cwd, readFileFn);
  const files = await changesetMarkdownFiles(cwd, readdirFn);
  const active = [];
  for (const file of files) {
    if (prereleaseChangesets.has(changesetSlug(file))) {
      continue;
    }
    const content = await readFileFn(join(cwd, ".changeset", file), "utf8");
    if (changesetHasReleaseBump(content)) {
      active.push(file);
    }
  }
  return active.sort();
}

async function changesetMarkdownFiles(cwd, readdirFn = readdir) {
  let entries = [];
  try {
    entries = await readdirFn(join(cwd, ".changeset"), { withFileTypes: true });
  } catch (error) {
    if (isMissingPath(error)) {
      return [];
    }
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile?.() ?? false)
    .map((entry) => entry.name)
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .sort();
}

async function prereleaseTrackedChangesets(cwd, readFileFn = readFile) {
  let preState;
  try {
    preState = JSON.parse(await readFileFn(join(cwd, ".changeset/pre.json"), "utf8"));
  } catch (error) {
    if (isMissingPath(error)) {
      return new Set();
    }
    throw error;
  }
  if (!Array.isArray(preState.changesets)) {
    return new Set();
  }
  return new Set(preState.changesets.filter((name) => typeof name === "string"));
}

function changesetSlug(file) {
  return file.replace(/\.md$/, "");
}

function changesetHasReleaseBump(content) {
  const frontmatter = changesetFrontmatter(content);
  if (frontmatter === undefined) {
    return true;
  }
  return frontmatter.split("\n").some((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith("#");
  });
}

function changesetFrontmatter(content) {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return undefined;
  }
  const lines = normalized.split("\n");
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === "---") {
      return lines.slice(1, index).join("\n");
    }
  }
  return undefined;
}

async function tagCommitFor(tagName, execFileFn = execFile, cwd = process.cwd()) {
  try {
    return await gitOutput(execFileFn, cwd, ["rev-list", "-n", "1", tagName]);
  } catch (error) {
    if (isExpectedMissingCommand(error)) {
      return "";
    }
    throw error;
  }
}

async function githubReleaseExists(tagName, execFileFn = execFile, cwd = process.cwd()) {
  try {
    await execFileFn("gh", ["release", "view", tagName, "--json", "tagName"], { cwd });
    return true;
  } catch (error) {
    if (isExpectedMissingCommand(error)) {
      return false;
    }
    throw error;
  }
}

async function containerImageExists(image, execFileFn = execFile, cwd = process.cwd()) {
  try {
    await execFileFn("docker", ["manifest", "inspect", image], { cwd });
    return true;
  } catch (error) {
    if (isExpectedMissingCommand(error)) {
      return false;
    }
    throw error;
  }
}

async function publicNpmPackageTrainStatus(
  packages,
  execFileFn = execFile,
  cwd = process.cwd(),
  options = {},
) {
  const attempts = positiveInteger(options.attempts ?? 1);
  const delayMs = nonNegativeInteger(options.delayMs ?? 0);
  const sleepFn = typeof options.sleep === "function" ? options.sleep : sleep;
  let missing = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    missing = [];
    for (const pkg of packages) {
      if (!(await npmPackageVersionExists(pkg.name, pkg.version, execFileFn, cwd))) {
        missing.push(`${pkg.name}@${pkg.version}`);
      }
    }
    if (missing.length === 0) {
      return { exists: true, attempts: attempt, missing: [] };
    }
    if (attempt < attempts && delayMs > 0) {
      await sleepFn(delayMs);
    }
  }
  return { exists: false, attempts, missing };
}

async function npmPackageVersionExists(name, version, execFileFn = execFile, cwd = process.cwd()) {
  let result;
  try {
    result = await execFileFn("npm", ["view", `${name}@${version}`, "version", "--json"], {
      cwd,
    });
  } catch (error) {
    if (isNpmPackageNotFound(error)) {
      return false;
    }
    throw error;
  }

  const stdout = String(result.stdout ?? "").trim();
  if (stdout.length === 0) {
    return false;
  }
  const publishedVersion = JSON.parse(stdout);
  return publishedVersion === version;
}

async function gitOutput(execFileFn, cwd, args) {
  const result = await execFileFn("git", args, { cwd });
  return String(result.stdout ?? "").trim();
}

function normalizeBoolean(value) {
  return value === true || value === "true";
}

function positiveInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) {
    return 1;
  }
  return Math.floor(number);
}

function nonNegativeInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return 0;
  }
  return Math.floor(number);
}

function pluralize(word, count) {
  return count === 1 ? word : `${word}s`;
}

function isMissingPath(error) {
  return error && typeof error === "object" && error.code === "ENOENT";
}

function isExpectedMissingCommand(error) {
  const code = error && typeof error === "object" ? error.code : undefined;
  return code === 1 || code === 128;
}

function isNpmPackageNotFound(error) {
  const code = error && typeof error === "object" ? error.code : undefined;
  if (code !== 1) {
    return false;
  }
  const details = [
    error instanceof Error ? error.message : "",
    error && typeof error === "object" && "stdout" in error ? error.stdout : "",
    error && typeof error === "object" && "stderr" in error ? error.stderr : "",
  ]
    .map((value) => String(value ?? "").toLowerCase())
    .join("\n");
  return (
    details.includes("e404") ||
    details.includes("404 not found") ||
    details.includes("is not in this registry") ||
    details.includes("no matching version found") ||
    details.includes("no match found for version")
  );
}

function printAlphaOutputs(result) {
  console.log(`version=${result.version}`);
  console.log(`tag=${result.tagName}`);
  console.log(`title=${result.title}`);
  console.log(`image=${result.image}`);
  if (result.notesPath) {
    console.log(`notes_path=${result.notesPath}`);
  }
  console.log(`should_complete=${String(result.shouldComplete)}`);
  console.log(`create_tag=${String(result.shouldCreateTag)}`);
  console.log(`run_goreleaser=${String(result.shouldRunGoreleaser)}`);
  console.log(`update_release=${String(result.shouldUpdateRelease)}`);
  console.log(`tag_exists=${String(result.tagExists)}`);
  console.log(`release_exists=${String(result.releaseExists)}`);
  console.log(`image_exists=${String(result.imageExists)}`);
  if (result.npmTrainExists !== undefined) {
    console.log(`npm_train_exists=${String(result.npmTrainExists)}`);
  }
  if (result.skipReason) {
    console.log(`skip_reason=${result.skipReason}`);
  }
}

function printPrunedChangesets(files) {
  console.log(`pruned_empty_changesets=${files.join(",")}`);
}

function isDirectRun(url) {
  return process.argv[1] && url === new URL(`file://${process.argv[1]}`).href;
}

if (isDirectRun(import.meta.url)) {
  try {
    const { command, values } = parseAlphaReleaseArgs(process.argv.slice(2));
    if (command === "prune-empty-changesets") {
      printPrunedChangesets(await pruneEmptyChangesets(values));
    } else {
      const result =
        command === "status"
          ? await inspectAlphaReleaseTrain(values)
          : await prepareAlphaReleaseTrain(values);
      printAlphaOutputs(result);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
