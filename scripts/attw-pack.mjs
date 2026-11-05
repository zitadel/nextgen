#!/usr/bin/env node
/**
 * Pack the current package with pnpm, then run Are the Types Wrong on the
 * tarball. `attw --pack` shells out to `npm pack`, which fails in this pnpm
 * workspace when npm is missing, is a corepack shim that refuses the
 * packageManager field, or cannot read the pnpm layout — and always exits 3
 * with only "Command failed: npm pack". Packing with pnpm matches how we
 * publish and what attw recommends for non-npm package managers.
 */
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { forwardedArgs, isDirectRun, run } from "./dev-process.mjs";

const defaultRepoRoot = fileURLToPath(new URL("..", import.meta.url));

export async function main(options = {}) {
  const attwArgs = options.args ?? forwardedArgs();
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const runFn = options.run ?? run;
  const packDir = options.packDir ?? mkdtempSync(join(options.tmpdir ?? tmpdir(), "zitadel-attw-"));
  const removePackDir = options.packDir == null;

  try {
    await runFn("corepack", ["pnpm", "pack", "--pack-destination", packDir], {
      cwd,
      env,
    });
    const tarball = readdirSync(packDir).find((name) => name.endsWith(".tgz"));
    if (!tarball) {
      throw new Error("pnpm pack did not produce a tarball");
    }
    await runFn("corepack", ["pnpm", "exec", "attw", join(packDir, tarball), ...attwArgs], {
      cwd: options.repoRoot ?? defaultRepoRoot,
      env,
    });
  } finally {
    if (removePackDir) {
      rmSync(packDir, { recursive: true, force: true });
    }
  }
}

if (isDirectRun(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(typeof error?.code === "number" && error.code !== 0 ? error.code : 1);
  }
}
