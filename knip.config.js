import { existsSync, globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

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
for (const match of globSync(packages, { cwd: root })) {
  const dir = match.replaceAll("\\", "/");
  if (!existsSync(join(root, dir, "package.json"))) {
    continue;
  }
  const config = join(root, dir, "knip.config.js");
  if (existsSync(config)) {
    workspaces[dir] = (await import(pathToFileURL(config).href)).default;
  } else {
    ignoreWorkspaces.push(dir);
  }
}

export default {
  exclude: ["catalog"],
  ignoreWorkspaces,
  workspaces,
};
