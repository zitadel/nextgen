#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  git,
  normalizeReleaseVersion,
  parseArgs,
  publicPackages,
  readPackage,
} from "./release-train.mjs";

const args = parseArgs(process.argv.slice(2));
const { tag, version } = normalizeReleaseVersion(args.version);
const output = args.output ?? "release-manifest.json";
const commit = args.commit ?? git(["rev-parse", "HEAD"]);
const ref = args.ref ?? "";
const channel = args.channel ?? "alpha";
const runtimeImage = args["runtime-image"] ?? `ghcr.io/zitadel/nextgen:${version}`;

const packages = Object.fromEntries(
  publicPackages.map((manifestPackage) => {
    const packageJson = readPackage(manifestPackage);
    return [
      packageJson.name,
      {
        version: packageJson.version,
        path: manifestPackage.path,
        install: `npm install ${packageJson.name}@${packageJson.version}`,
      },
    ];
  }),
);

const manifest = {
  schema_version: 1,
  product: {
    name: "Zitadel next-generation preview",
    version,
    git_tag: tag,
    channel,
  },
  source: {
    ref,
    commit,
  },
  runtime: {
    image: runtimeImage,
  },
  npm: {
    dist_tag: channel,
    install_hints: {
      cli_npx: `npx @zitadel/cli@${channel}`,
      cli_global: `npm install -g @zitadel/cli@${version}`,
    },
    packages,
  },
};

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${output}`);
