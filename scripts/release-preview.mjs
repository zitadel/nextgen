#!/usr/bin/env node
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export const PRODUCT_NAME = "zitadel-preview";
export const SERVER_IMAGE_NAME = "ghcr.io/zitadel/nextgen";

const PREVIEW_VERSION_RE = /^0\.\d+\.\d+$/;
const NPM_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/;
const MUTABLE_IMAGE_TAGS = new Set([
  "latest",
  "alpha",
  "beta",
  "next",
  "canary",
  "edge",
  "main",
  "master",
]);

export async function preparePreviewRelease(options) {
  const previewVersion = validatePreviewVersion(options.previewVersion);
  const commit = requiredString(options.commit, "commit");
  const serverImage = requiredString(options.serverImage, "serverImage");
  const serverVersion = imageTagFromRef(serverImage);
  assertImmutableImageRef(serverImage);

  const npmPackages = npmPackagesFromOptions(options);
  const verifyNpmPackageFn = options.verifyNpmPackage ?? verifyNpmPackage;
  const resolveDockerDigestFn = options.resolveDockerDigest ?? resolveDockerDigest;
  const readFileFn = options.readFile ?? readFile;
  const writeFileFn = options.writeFile ?? writeFile;
  const mkdirFn = options.mkdir ?? mkdir;

  const serverDigest = await resolveDockerDigestFn(serverImage);
  for (const pkg of npmPackages) {
    await verifyNpmPackageFn(pkg.name, pkg.version);
  }

  const manifest = buildPreviewManifest({
    previewVersion,
    commit,
    serverImage,
    serverVersion,
    serverDigest,
    npmPackages,
  });
  const tagName = `zitadel-preview-v${previewVersion}`;
  const title = `ZITADEL Preview ${previewVersion}`;
  const assetName = `zitadel-preview-${previewVersion}.json`;
  const repository = options.repository ?? process.env.GITHUB_REPOSITORY ?? "zitadel/nextgen";
  const manifestUrl = `https://github.com/${repository}/releases/download/${tagName}/${assetName}`;
  const releaseNotesIntro = options.releaseNotesPath
    ? await readFileFn(options.releaseNotesPath, "utf8")
    : "";
  const releaseNotes = renderReleaseNotes({
    title,
    manifest,
    manifestUrl,
    intro: releaseNotesIntro,
  });
  const outDir = options.outDir ?? "dist/preview-release";
  await mkdirFn(outDir, { recursive: true });
  const manifestPath = join(outDir, assetName);
  const notesPath = join(outDir, `zitadel-preview-${previewVersion}-notes.md`);
  await writeFileFn(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFileFn(notesPath, releaseNotes);

  return { tagName, title, assetName, manifestPath, notesPath, manifestUrl, manifest };
}

export function buildPreviewManifest(options) {
  return {
    schema_version: 1,
    product: {
      name: PRODUCT_NAME,
      version: options.previewVersion,
      commit: options.commit,
    },
    components: [
      {
        kind: "container",
        name: SERVER_IMAGE_NAME,
        version: options.serverVersion,
        ref: options.serverImage,
        digest: options.serverDigest,
      },
      ...options.npmPackages.map((pkg) => ({
        kind: "npm",
        name: pkg.name,
        version: pkg.version,
      })),
    ],
  };
}

export function renderReleaseNotes(options) {
  const intro = options.intro.trim();
  const lines = [`# ${options.title}`, ""];
  if (intro) {
    lines.push(intro, "");
  }
  lines.push("## Preview Manifest", "", options.manifestUrl, "");
  lines.push("## Tested Components", "");
  lines.push("| Kind | Name | Version | Reference |");
  lines.push("| --- | --- | --- | --- |");
  for (const component of options.manifest.components) {
    if (component.kind === "container") {
      const reference = component.ref.includes("@sha256:")
        ? component.ref
        : `${component.ref}@${component.digest}`;
      lines.push(
        `| container | \`${component.name}\` | \`${component.version}\` | \`${reference}\` |`,
      );
      continue;
    }
    if (component.kind === "npm") {
      lines.push(`| npm | \`${component.name}\` | \`${component.version}\` | npm |`);
      continue;
    }
    if (component.optional === true) {
      lines.push(`| ${component.kind} | optional | - | - |`);
    }
  }
  const cli = options.manifest.components.find(
    (component) => component.kind === "npm" && component.name === "@zitadel/cli",
  );
  if (!cli) {
    throw new Error("Preview manifest must include @zitadel/cli");
  }
  lines.push("", "## Tester Commands", "");
  lines.push("```sh");
  lines.push(`npx @zitadel/cli@${cli.version} doctor --preview-manifest ${options.manifestUrl}`);
  lines.push(`npx @zitadel/cli@${cli.version} start --preview-manifest ${options.manifestUrl}`);
  lines.push(
    `npx @zitadel/cli@${cli.version} setup --framework next --server local --preview-manifest ${options.manifestUrl}`,
  );
  lines.push("```", "");
  return `${lines.join("\n")}\n`;
}

export function npmPackagesFromOptions(options) {
  const packages = [
    { name: "@zitadel/cli", version: requiredString(options.cliVersion, "cliVersion") },
    { name: "@zitadel/sdk-next", version: requiredString(options.sdkNextVersion, "sdkNextVersion") },
    ...parseAdditionalNpmPackages(options.additionalNpmPackagesJson ?? "{}"),
  ];
  const seen = new Set();
  for (const pkg of packages) {
    validateNpmPackage(pkg);
    if (seen.has(pkg.name)) {
      throw new Error(`Duplicate npm package ${pkg.name}`);
    }
    seen.add(pkg.name);
  }
  return packages;
}

export function parseAdditionalNpmPackages(input) {
  const value = JSON.parse(input);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("additional npm packages must be a JSON object");
  }
  return Object.entries(value).map(([name, version]) => {
    if (typeof version !== "string") {
      throw new Error(`npm package ${name} version must be a string`);
    }
    return { name, version };
  });
}

export function validatePreviewVersion(version) {
  const value = requiredString(version, "previewVersion");
  if (!PREVIEW_VERSION_RE.test(value)) {
    throw new Error("preview_version must match 0.x.y");
  }
  return value;
}

export function assertImmutableImageRef(ref) {
  const tag = imageTagFromRef(ref);
  if (MUTABLE_IMAGE_TAGS.has(tag)) {
    throw new Error(`server_image must not use mutable tag ${tag}`);
  }
}

export function imageTagFromRef(ref) {
  const value = requiredString(ref, "serverImage");
  const withoutDigest = value.split("@")[0] ?? "";
  const slash = withoutDigest.lastIndexOf("/");
  const colon = withoutDigest.lastIndexOf(":");
  if (colon <= slash) {
    throw new Error("server_image must include an immutable tag");
  }
  const tag = withoutDigest.slice(colon + 1);
  if (!tag) {
    throw new Error("server_image must include an immutable tag");
  }
  return tag;
}

export async function resolveDockerDigest(ref, options = {}) {
  const digestFromRef = ref.match(/@(?<digest>sha256:[0-9a-f]{64})$/i)?.groups?.digest;
  if (digestFromRef) {
    return digestFromRef;
  }
  const execFileFn = options.execFile ?? execFile;
  const { stdout } = await execFileFn("docker", ["buildx", "imagetools", "inspect", ref], {
    encoding: "utf8",
  });
  const digest = stdout.match(/Digest:\s*(sha256:[0-9a-f]{64})/i)?.[1];
  if (!digest) {
    throw new Error(`Could not resolve digest for ${ref}`);
  }
  return digest;
}

export async function verifyNpmPackage(name, version, options = {}) {
  validateNpmPackage({ name, version });
  const execFileFn = options.execFile ?? execFile;
  const spec = `${name}@${version}`;
  const { stdout } = await execFileFn("npm", ["view", spec, "version", "--json"], {
    encoding: "utf8",
  });
  const publishedVersion = JSON.parse(stdout);
  if (publishedVersion !== version) {
    throw new Error(`npm view ${spec} returned ${String(publishedVersion)}`);
  }
}

export function parsePrepareArgs(argv) {
  const args = [...argv];
  const command = args.shift();
  if (command !== "prepare") {
    throw new Error(
      "Usage: release-preview.mjs prepare --preview-version <0.x.y> --commit <sha> --server-image <ref> --cli-version <version> --sdk-next-version <version>",
    );
  }
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument ${arg}`);
    }
    const key = camelCase(arg.slice(2));
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    values[key] = next;
    index += 1;
  }
  return values;
}

function validateNpmPackage(pkg) {
  if (!pkg.name || typeof pkg.name !== "string") {
    throw new Error("npm package name must be a non-empty string");
  }
  if (!NPM_VERSION_RE.test(pkg.version)) {
    throw new Error(`${pkg.name} version must be an exact npm version`);
  }
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function camelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function isDirectRun(url) {
  return process.argv[1] && url === new URL(`file://${process.argv[1]}`).href;
}

if (isDirectRun(import.meta.url)) {
  try {
    const result = await preparePreviewRelease(parsePrepareArgs(process.argv.slice(2)));
    console.log(`tag=${result.tagName}`);
    console.log(`title=${result.title}`);
    console.log(`asset_name=${result.assetName}`);
    console.log(`manifest_path=${result.manifestPath}`);
    console.log(`notes_path=${result.notesPath}`);
    console.log(`manifest_url=${result.manifestUrl}`);
    console.log(`manifest_file=${basename(result.manifestPath)}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
