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

const packageLinks = publicPackages
  .map((manifestPackage) => `- ${manifestPackage.name}: \`${manifestPackage.path}/CHANGELOG.md\``)
  .join("\n");

const knownLimitations = extractKnownLimitations(productSection);

const packageNotes =
  packageSections.length > 0
    ? packageSections
        .map(
          (manifestPackage) =>
            `### ${manifestPackage.title} (${manifestPackage.name})\n\n${manifestPackage.section}`,
        )
        .join("\n\n")
    : "No package-specific changelog sections were generated for this release.";

const notes = `# Zitadel next-generation preview ${tag}

Zitadel v5 is the next-generation preview train from this repository. It uses
the v5 major because this project may become the successor to the classic
Zitadel product released from \`zitadel/zitadel\`.

This is an alpha preview. SemVer-shaped alpha versions are release coordinates;
breaking changes can happen between alpha releases and are called out here.

## What To Install

| Surface | Version |
| --- | --- |
| Product tag | \`${tag}\` |
| Server image | \`ghcr.io/zitadel/nextgen:${version}\` |
| CLI | \`@zitadel/cli@${version}\` |
| API client | \`@zitadel/api@${version}\` |
| Components | \`@zitadel/components@${version}\` |
| Core SDK | \`@zitadel/sdk-core@${version}\` |
| Next.js SDK | \`@zitadel/sdk-next@${version}\` |
| Nuxt SDK | \`@zitadel/sdk-nuxt@${version}\` |
| React SDK | \`@zitadel/sdk-react@${version}\` |
| Vue SDK | \`@zitadel/sdk-vue@${version}\` |
| Angular SDK | \`@zitadel/sdk-angular@${version}\` |

## Install The CLI

\`\`\`sh
npx @zitadel/cli@alpha doctor
npm install -g @zitadel/cli@${version}
\`\`\`

## Start The Server

\`\`\`sh
docker run --rm -p 8080:8080 ghcr.io/zitadel/nextgen:${version}
\`\`\`

## Add Auth To A Next.js App

\`\`\`sh
npm install @zitadel/sdk-next@${version} @zitadel/components@${version}
zitadel setup --framework next --server local
\`\`\`

## Product Changes

${productSection}

## Known Limitations

${knownLimitations}

## Package Changes

${packageNotes}

## Package Changelogs

${packageLinks}

## Versions

- Product train: \`${tag}\`

${packageVersions}
`;

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, notes);
console.log(`wrote ${output}`);

function extractKnownLimitations(markdown) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => /^#{3,4}\s+known limitations\s*$/i.test(line.trim()));
  if (start === -1) {
    return "_No release-specific limitations were called out in the `@zitadel/product` changelog._";
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^#{1,4}\s+/.test(lines[index])) {
      end = index;
      break;
    }
  }

  return lines.slice(start + 1, end).join("\n").trim() || "_No release-specific limitations were called out in the `@zitadel/product` changelog._";
}
