#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  extractChangelogSection,
  normalizeReleaseVersion,
  parseArgs,
  productPackage,
  publicPackages,
  readChangelog,
  readPackage,
} from "./release-train.mjs";

const args = parseArgs(process.argv.slice(2));
const { tag, version } = normalizeReleaseVersion(args.version);
const output = args.output ?? "release-notes.md";

const productSection = extractChangelogSection(readChangelog(productPackage), version);
if (!productSection) {
  throw new Error(
    `${productPackage.path}/CHANGELOG.md does not contain "## ${version}". Add a changeset for @zitadel/product and merge the Version Packages PR before releasing.`,
  );
}

const packageSections = publicPackages
  .map((manifestPackage) => ({
    ...manifestPackage,
    version: readPackage(manifestPackage).version,
    section: extractChangelogSection(readChangelog(manifestPackage), version),
  }))
  .filter((manifestPackage) => manifestPackage.section.length > 0);

const packageVersions = publicPackages
  .map((manifestPackage) => {
    const packageJson = readPackage(manifestPackage);
    return `- ${manifestPackage.name}: \`${packageJson.version}\``;
  })
  .join("\n");

const packageNotes =
  packageSections.length > 0
    ? packageSections
        .map(
          (manifestPackage) =>
            `### ${manifestPackage.title} (${manifestPackage.name})\n\n${manifestPackage.section}`,
        )
        .join("\n\n")
    : "No package-specific changelog sections were generated for this release.";

const notes = `# Zitadel ${tag}

Zitadel v5 is the next-generation release train from this repository. It uses
the v5 major because this project may become the successor to the classic
Zitadel product released from \`zitadel/zitadel\`.

This is an alpha release. Use it only when you intentionally opt in to the v5
train.

## Install

- Runtime image: \`ghcr.io/zitadel/nextgen:${version}\`
- CLI: \`npx @zitadel/cli@alpha\`
- npm packages: lockstep \`@zitadel/*@${version}\` packages on the \`alpha\` dist-tag
- Git tag: \`${tag}\`

## Product Changes

${productSection}

## Package Changes

${packageNotes}

## Versions

- Product train: \`${tag}\`

${packageVersions}
`;

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, notes);
console.log(`wrote ${output}`);
