#!/usr/bin/env node
/**
 * Fails when a Go module in go.work compiles with other dependency versions
 * than its own go.mod selects.
 *
 * go.work is committed so that turbo treats the Go modules as packages
 * (turbo.json), and inside a workspace Go builds every module with one build
 * list: the highest version any module requires. A module whose go.mod asks
 * for less would be built and tested here against versions that its users,
 * and any build outside the workspace (GOWORK=off), do not get. So for every
 * package a module's packages and tests load, under the default build tags
 * and under the integration lanes' tags, its go.mod must select what the
 * workspace selects.
 *
 * `--fix` raises the lower requirements (`go get`, then `go mod tidy`, both
 * outside the workspace) until nothing differs. `go work sync` is not
 * enough: it left the server module below versions bench requires.
 *
 * Usage: node scripts/check-go-work.mjs [--fix]
 */
import { execFile } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { isDirectRun } from "./dev-process.mjs";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));

/**
 * Build tag sets each module is loaded under: the default, the console-less
 * build, and each integration lane on its own (every lane has a TestMain of
 * its own, so they do not load together).
 */
export const TAG_SETS = [
  [],
  ["noconsole"],
  ["postgres_integration"],
  ["spanner_integration"],
  ["sqlite_integration"],
];

const FIX_ROUNDS = 5;

async function go(dir, args, env) {
  try {
    const { stdout } = await exec("go", args, {
      cwd: join(root, dir),
      env,
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    throw new Error(`${dir}: go ${args.join(" ")}\n${error.stderr || error.message}`);
  }
}

/** Module path → version, for the module of every package `dir` loads. */
async function loadedVersions(dir, tags, env) {
  const args = ["list", "-deps", "-test", "-f", "{{with .Module}}{{.Path}} {{.Version}}{{end}}"];
  if (tags.length > 0) args.push("-tags", tags.join(","));
  const versions = new Map();
  for (const line of (await go(dir, [...args, "./..."], env)).split("\n")) {
    const [path, version] = line.split(" ");
    if (path) versions.set(path, version);
  }
  return versions;
}

/**
 * The modules both builds load at different versions, by path. The
 * workspace's own modules are skipped: outside the workspace they resolve
 * through replace directives, inside it they have no version.
 */
export function versionDifferences(own, workspace, skip) {
  const differences = [];
  for (const [path, version] of own) {
    const selected = workspace.get(path);
    if (skip.has(path) || selected === undefined || selected === version) continue;
    differences.push({ path, own: version, workspace: selected });
  }
  return differences.sort((a, b) => a.path.localeCompare(b.path));
}

async function compare(dirs, skip, envs) {
  return Promise.all(
    dirs.map(async (dir) => {
      const differences = new Map();
      for (const tags of TAG_SETS) {
        const [own, workspace] = await Promise.all([
          loadedVersions(dir, tags, envs.own),
          loadedVersions(dir, tags, envs.workspace),
        ]);
        for (const difference of versionDifferences(own, workspace, skip)) {
          differences.set(difference.path, difference);
        }
      }
      return { dir, differences: [...differences.values()] };
    }),
  );
}

export async function main(argv = process.argv.slice(2)) {
  const fix = argv.includes("--fix");
  const envs = {
    own: { ...process.env, GOWORK: "off" },
    workspace: { ...process.env, GOWORK: join(root, "go.work") },
  };
  try {
    const dirs = JSON.parse(await go(".", ["work", "edit", "-json"], envs.workspace)).Use.map(
      (use) => use.DiskPath.replace(/^\.\//, ""),
    );
    const skip = new Set(
      await Promise.all(
        dirs.map(
          async (dir) => JSON.parse(await go(dir, ["mod", "edit", "-json"], envs.own)).Module.Path,
        ),
      ),
    );
    for (let round = 1; ; round++) {
      if (fix) {
        for (const dir of dirs) await go(dir, ["mod", "tidy"], envs.own);
      }
      const drifted = (await compare(dirs, skip, envs)).filter(
        ({ differences }) => differences.length > 0,
      );
      if (drifted.length === 0) return 0;
      if (!fix || round === FIX_ROUNDS) {
        console.error(
          "error: these Go modules compile with other versions inside go.work than alone:",
        );
        for (const { dir, differences } of drifted) {
          console.error(dir);
          for (const { path, own, workspace } of differences) {
            console.error(`  ${path} ${own} (go.work selects ${workspace})`);
          }
        }
        console.error(
          "hint: run `node scripts/check-go-work.mjs --fix`, which raises each go.mod to the workspace's versions",
        );
        return 1;
      }
      for (const { dir, differences } of drifted) {
        await go(
          dir,
          ["get", ...differences.map(({ path, workspace }) => `${path}@${workspace}`)],
          envs.own,
        );
      }
    }
  } catch (error) {
    console.error(`error: ${error.message}`);
    if (!fix)
      console.error("hint: `node scripts/check-go-work.mjs --fix` tidies every module first");
    return 1;
  }
}

if (isDirectRun(import.meta.url)) {
  process.exit(await main());
}
