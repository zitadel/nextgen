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
// `knip --workspace <name>` (each package's lint): load only that package, so
// another package's tool configs are never loaded.
const only = process.argv.includes("--workspace")
  ? process.argv[process.argv.indexOf("--workspace") + 1]
  : undefined;
for (const match of globSync(packages, { cwd: root })) {
  const dir = match.replaceAll("\\", "/");
  if (!existsSync(join(root, dir, "package.json"))) {
    continue;
  }
  const { name } = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8"));
  const config = join(root, dir, "knip.config.js");
  if (existsSync(config) && (only === undefined || name === only)) {
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
