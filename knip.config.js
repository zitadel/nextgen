import { existsSync, globSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "yaml";

const root = import.meta.dirname;
const { packages } = parse(readFileSync(join(root, "pnpm-workspace.yaml"), "utf8"));

const workspaces = {
  ".": {
    entry: [],
    project: [],
    ignoreDependencies: [/.*/],
    ignoreBinaries: [/.*/],
  },
};
const ignoreWorkspaces = [];
for (const dir of globSync(packages, { cwd: root })) {
  if (!existsSync(join(root, dir, "package.json"))) {
    continue;
  }
  const config = join(root, dir, "knip.config.js");
  if (existsSync(config)) {
    workspaces[dir] = (await import(config)).default;
  } else {
    ignoreWorkspaces.push(dir);
  }
}

export default {
  exclude: ["catalog"],
  ignoreWorkspaces,
  workspaces,
};
