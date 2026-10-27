import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { packPublicPackages } from "../../../scripts/release-artifacts.mjs";
import { PUBLIC_RELEASE_PACKAGES } from "../../../scripts/release-manifest.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = join(import.meta.dirname, "..", "..", "..");

/**
 * Installs this commit's CLI the way a developer gets it: `@zitadel/cli` and
 * the workspace packages it depends on, packed by the release's own code
 * (`packPublicPackages`, which `moon run release:pack` runs, prepack
 * included), installed with npm into `dir` from those tarballs and the public
 * registry. The server's platform binaries are optional dependencies and left
 * out: against a hosted server the CLI starts none. Returns the installed
 * `zitadel` binary.
 */
export async function installPackedCli(dir: string): Promise<string> {
  const tarballsDir = join(dir, "tarballs");
  await packPublicPackages({ repoRoot, dirs: await cliPackageDirs(), tarballsDir });
  const tarballs = (await readdir(tarballsDir)).map((name) => join(tarballsDir, name));
  const prefix = join(dir, "cli");
  await execFileAsync(
    "npm",
    ["install", "--prefix", prefix, "--omit=optional", "--no-audit", "--no-fund", ...tarballs],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  return join(prefix, "node_modules", ".bin", "zitadel");
}

/**
 * The folders of `@zitadel/cli` and every public package it reaches through
 * `workspace:` dependencies, read from the manifests so a new one is packed
 * without a list to keep.
 */
async function cliPackageDirs(): Promise<string[]> {
  const dirs = new Set<string>();
  const visit = async (name: string) => {
    const pkg = PUBLIC_RELEASE_PACKAGES.find((candidate) => candidate.name === name);
    if (!pkg) {
      throw new Error(`${name} is a workspace dependency of the CLI but no public package`);
    }
    if (dirs.has(pkg.dir)) {
      return;
    }
    dirs.add(pkg.dir);
    const manifest = JSON.parse(await readFile(join(repoRoot, pkg.dir, "package.json"), "utf8"));
    for (const [dependency, spec] of Object.entries(manifest.dependencies ?? {})) {
      if (String(spec).startsWith("workspace:")) {
        await visit(dependency);
      }
    }
  };
  await visit("@zitadel/cli");
  return [...dirs];
}
