import { existsSync, globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { parse } from "yaml";

import { wantedWorkspaces } from "./scripts/knip-workspaces.mjs";

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
// Each package's lint (`knip --workspace <name>`) loads only that package, so
// another package's tool configs are never loaded.
const wanted = wantedWorkspaces(process.argv);
for (const match of globSync(packages, { cwd: root })) {
  const dir = match.replaceAll("\\", "/");
  if (!existsSync(join(root, dir, "package.json"))) {
    continue;
  }
  const { name } = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8"));
  const config = join(root, dir, "knip.config.js");
  if (existsSync(config) && wanted(name, dir)) {
    workspaces[dir] = (await import(pathToFileURL(config).href)).default;
  } else {
    ignoreWorkspaces.push(dir);
  }
}

export default {
  exclude: ["catalog"],
  // An interface its own file uses may be exported only so another module can
  // extend it (declaration merging), which knip does not count as a use.
  ignoreExportsUsedInFile: { interface: true },
  ignoreWorkspaces,
  workspaces,
};
