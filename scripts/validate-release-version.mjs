#!/usr/bin/env node
import {
  lockstepPackages,
  normalizeReleaseVersion,
  parseArgs,
  readJson,
  readPackage,
} from "./release-train.mjs";

const args = parseArgs(process.argv.slice(2));
const { tag, version, baseVersion } = normalizeReleaseVersion(args.version);
const errors = [];

const config = readJson(".changeset/config.json");
const expectedNames = lockstepPackages.map((manifestPackage) => manifestPackage.name);
const fixedGroups = config.fixed ?? [];
const fixedGroup = fixedGroups.find((group) =>
  expectedNames.every((name) => group.includes(name)),
);

if (!fixedGroup) {
  errors.push(
    `.changeset/config.json must contain one fixed group with: ${expectedNames.join(", ")}`,
  );
} else {
  const extraNames = fixedGroup.filter((name) => !expectedNames.includes(name));
  if (extraNames.length > 0 || fixedGroup.length !== expectedNames.length) {
    errors.push(`lockstep fixed group has unexpected packages: ${extraNames.join(", ")}`);
  }
}

if (config.privatePackages?.version !== true || config.privatePackages?.tag !== false) {
  errors.push('.changeset/config.json must set privatePackages to { "version": true, "tag": false }');
}

for (const manifestPackage of lockstepPackages) {
  const packageJson = readPackage(manifestPackage);
  if (packageJson.name !== manifestPackage.name) {
    errors.push(`${manifestPackage.path}/package.json name is ${packageJson.name}`);
  }
  if (packageJson.version !== version) {
    errors.push(`${manifestPackage.name} is ${packageJson.version}, expected ${version}`);
  }
  if (manifestPackage.name === "@zitadel/product" && packageJson.private !== true) {
    errors.push("@zitadel/product must stay private");
  }
  if (manifestPackage.name !== "@zitadel/product" && packageJson.private === true) {
    errors.push(`${manifestPackage.name} must be publishable, not private`);
  }
}

const preJson = readJson(".changeset/pre.json");
if (version.includes("-alpha.") && (preJson.mode !== "pre" || preJson.tag !== "alpha")) {
  errors.push(".changeset/pre.json must stay in alpha prerelease mode for alpha releases");
}
for (const manifestPackage of lockstepPackages) {
  const initialVersion = preJson.initialVersions?.[manifestPackage.name];
  if (version.includes("-alpha.") && initialVersion !== baseVersion) {
    errors.push(
      `.changeset/pre.json initial version for ${manifestPackage.name} is ${initialVersion}, expected ${baseVersion}`,
    );
  }
}

if (errors.length > 0) {
  console.error(`Cannot release ${tag}:`);
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`release train is aligned for ${tag}`);
