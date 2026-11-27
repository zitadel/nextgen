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
// `knip --workspace <name>` (each package's lint): load only the packages
// named, by name or directory, so another package's tool configs are never
// loaded. A glob, or no filter at all, loads every package.
const filters = process.argv.flatMap((arg, at, args) => {
  if (arg === "--workspace" || arg === "-W") {
    return [args[at + 1]];
  }
  if (arg.startsWith("--workspace=")) {
    return [arg.slice("--workspace=".length)];
  }
  return [];
});
const exact = filters.length > 0 && filters.every((filter) => !/[*?{[!]/.test(filter));
const wanted = new Set(filters.map((filter) => filter.replace(/^\.\//, "").replace(/\/$/, "")));
for (const match of globSync(packages, { cwd: root })) {
  const dir = match.replaceAll("\\", "/");
  if (!existsSync(join(root, dir, "package.json"))) {
    continue;
  }
  const { name } = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8"));
  const config = join(root, dir, "knip.config.js");
  if (existsSync(config) && (!exact || wanted.has(name) || wanted.has(dir))) {
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
