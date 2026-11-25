import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// @boundaries-ignore root scripts/ belongs to the workspace root, which no package can depend on
import { packPublicPackages } from "../../../scripts/release-artifacts.mjs";
import { sharedPackageDirs, sharedPackagesDir } from "./journey-packages.mjs";

// The `journey-packages` task: packs, once per run, the packages every CI
// journey installs, from the builds the task depends on. Each journey packs
// only the rest of its set and copies these (local-registry.mjs).
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const dirs = sharedPackageDirs(repoRoot);
const tarballsDir = sharedPackagesDir(repoRoot);
await packPublicPackages({ repoRoot, dirs, tarballsDir });
console.log(`packed ${dirs.join(", ")} into ${tarballsDir}`);
