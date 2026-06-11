#!/usr/bin/env node
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
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

export async function prepareAlphaReleaseTrain(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const readFileFn = options.readFile ?? readFile;
  const writeFileFn = options.writeFile ?? writeFile;
  const mkdirFn = options.mkdir ?? mkdir;
  const execFileFn = options.execFile ?? execFile;
  const outDir = options.outDir ?? join(cwd, "dist/alpha-release");

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
  if (await tagExists(tagName, execFileFn, cwd)) {
    throw new Error(`release tag ${tagName} already exists`);
  }

  const image = `${SERVER_IMAGE_NAME}:${version}`;
  const title = `ZITADEL Alpha ${version}`;
  const notes = renderAlphaReleaseNotes({ title, version, image, packages });
  await mkdirFn(outDir, { recursive: true });
  const notesPath = join(outDir, `zitadel-alpha-${version}-notes.md`);
  await writeFileFn(notesPath, notes);

  return { version, tagName, title, image, notesPath, packages };
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
  try {
    await execFileFn("git", ["rev-parse", "--verify", `refs/tags/${tagName}`], { cwd });
    return true;
  } catch (error) {
    const code = error && typeof error === "object" ? error.code : undefined;
    if (code === 1 || code === 128) {
      return false;
    }
    throw error;
  }
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

export function parsePrepareArgs(args) {
  if (args[0] !== "prepare") {
    throw new Error("Usage: release-alpha-train.mjs prepare [--out-dir <path>]");
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
  return values;
}

function camelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function isDirectRun(url) {
  return process.argv[1] && url === new URL(`file://${process.argv[1]}`).href;
}

if (isDirectRun(import.meta.url)) {
  try {
    const result = await prepareAlphaReleaseTrain(parsePrepareArgs(process.argv.slice(2)));
    console.log(`version=${result.version}`);
    console.log(`tag=${result.tagName}`);
    console.log(`title=${result.title}`);
    console.log(`image=${result.image}`);
    console.log(`notes_path=${result.notesPath}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
