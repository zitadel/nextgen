#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const publicPackageDirs = [
  "apps/cli",
  "packages/api",
  "packages/components",
  "packages/sdk-core",
  "packages/sdk-next",
  "packages/sdk-nuxt",
  "packages/sdk-react",
  "packages/sdk-vue",
  "packages/sdk-angular",
];

const tag = readTag(process.argv.slice(2));
const expectedVersion = normalizeTag(tag);
const versions = [];

for (const dir of publicPackageDirs) {
  const manifest = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
  if (manifest.private === true) {
    throw new Error(`${manifest.name} in ${dir} is private; preview bundles only include public packages`);
  }
  if (manifest.version !== expectedVersion) {
    throw new Error(
      `${manifest.name} is ${manifest.version}, expected ${expectedVersion} for ${tag}`,
    );
  }
  versions.push(`${manifest.name}@${manifest.version}`);
}

const goreleaser = await readFile(".goreleaser.yaml", "utf8");
assertIncludes(goreleaser, "name_template: 'ZITADEL Preview {{ .Version }}'");
assertIncludes(goreleaser, "name_template: 'zitadel-preview_{{ .Version }}_{{ .Os }}_{{ .Arch }}'");
assertIncludes(goreleaser, "'ghcr.io/zitadel/zitadel-preview'");
assertIncludes(goreleaser, "{{ if not .IsSnapshot }}preview{{ end }}");

console.log(`preview release ${tag} verified: ${versions.join(", ")}`);

function readTag(args) {
  const tagIndex = args.indexOf("--tag");
  const value = tagIndex >= 0 ? args[tagIndex + 1] : process.env.GITHUB_REF_NAME;
  if (!value) {
    throw new Error("usage: node scripts/verify-preview-release.mjs --tag v0.1.0[-alpha.N]");
  }
  return value;
}

function normalizeTag(value) {
  const normalized = value.trim().replace(/^refs\/tags\//, "").replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+(?:-alpha\.\d+)?$/.test(normalized)) {
    throw new Error(`release tag must look like v0.1.0 or v0.1.0-alpha.N, got ${value}`);
  }
  return normalized;
}

function assertIncludes(contents, expected) {
  if (!contents.includes(expected)) {
    throw new Error(`.goreleaser.yaml must contain ${expected}`);
  }
}
