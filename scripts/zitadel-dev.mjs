#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const build = spawnSync("corepack", ["pnpm", "--filter", "zitadel", "build"], {
  encoding: "utf8",
});

if (build.stdout) process.stderr.write(build.stdout);
if (build.stderr) process.stderr.write(build.stderr);

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const cli = spawnSync(process.execPath, ["apps/cli/dist/zitadel.js", ...process.argv.slice(2)], {
  stdio: "inherit",
});

process.exit(cli.status ?? 1);
