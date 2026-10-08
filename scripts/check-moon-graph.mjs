#!/usr/bin/env node
// Checks the moon task graph against the rules in .moon/AGENTS.md:
//
//   1. No transitive duplicates: a task does not list a dependency that
//      another of its dependencies already reaches.
//   2. A task that depends on another project's task belongs to a project
//      that declares that package in package.json.
//   3. Every workspace package a project declares is reached by one of its
//      tasks, directly or transitively.
//
// It reads the resolved graph (shared .moon/tasks config plus each moon.yml)
// from `moon query projects`. Usage: node scripts/check-moon-graph.mjs
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

// Tasks allowed to list every dependency explicitly. release:check-graph
// requires build-public-packages to name each public package's build-release.
const DUPLICATES_ALLOWED = new Set(["release:build-public-packages"]);

// Edges on another project's build artifact, not on its code, so there is no
// package.json entry to match.
function artifactEdge(project, target) {
  if (project === "release") return true; // packages and publishes everything
  if (project === "server") return target === "console" || target === "login-ui"; // //go:embed of the UI dists
  if (project === "testing") return target === "server"; // integration tests boot the binary
  if (project.endsWith("-e2e"))
    return ["cli", "server", "console", "demo-next", "demo-nuxt"].includes(target);
  return false;
}

// Declared packages no task needs to build first.
const UNREACHED_ALLOWED = new Set([
  "cli:@zitadel/server", // the runtime wrapper; cli:test lists it as an input
  "console:@zitadel/testing", // dev-real only, resolved from source
]);

const output = execFileSync("corepack", ["pnpm", "exec", "moon", "query", "projects"], {
  cwd: root,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"],
  maxBuffer: 256 * 1024 * 1024,
});
const { projects } = JSON.parse(output.slice(output.indexOf("{")));

const deps = new Map();
// Edges moon hashes: a dependency on a task without outputs is not hashed.
const hashed = new Map();
const projectOfPackage = new Map();
const packagesOf = new Map();
for (const project of projects) {
  for (const task of Object.values(project.tasks)) {
    deps.set(
      task.target,
      (task.deps ?? []).map((dep) => dep.target),
    );
    hashed.set(
      task.target,
      (task.deps ?? []).filter((dep) => dep.cacheStrategy !== "ignored").map((dep) => dep.target),
    );
  }
  try {
    const manifest = JSON.parse(readFileSync(join(root, project.source, "package.json"), "utf8"));
    projectOfPackage.set(manifest.name, project.id);
    packagesOf.set(
      project.id,
      new Set(
        Object.keys({
          ...manifest.dependencies,
          ...manifest.devDependencies,
          ...manifest.peerDependencies,
          ...manifest.optionalDependencies,
        }),
      ),
    );
  } catch {
    packagesOf.set(project.id, new Set());
  }
}
const packageOfProject = new Map([...projectOfPackage].map(([name, id]) => [id, name]));
const projectOf = (target) => target.split(":")[0];

function closure(edges) {
  const memo = new Map();
  const walk = (target) => {
    if (memo.has(target)) return memo.get(target);
    const seen = new Set();
    memo.set(target, seen);
    for (const dep of edges.get(target) ?? []) {
      seen.add(dep);
      for (const next of walk(dep)) seen.add(next);
    }
    return seen;
  };
  return walk;
}
const reach = closure(deps);
// A dependency is only redundant when another one reaches it through hashed
// edges, so dropping it changes neither the run order nor the cache key.
const reachHashed = closure(hashed);

const problems = [];
for (const [target, list] of deps) {
  const project = projectOf(target);
  for (const dep of list) {
    const via = (hashed.get(target) ?? []).find(
      (other) => other !== dep && reachHashed(other).has(dep),
    );
    if (via && !DUPLICATES_ALLOWED.has(target)) {
      problems.push(`${target}: "${dep}" is already reached through "${via}"; remove it`);
    }
    const other = projectOf(dep);
    if (other === project || artifactEdge(project, other)) continue;
    const name = packageOfProject.get(other);
    if (!name || !packagesOf.get(project).has(name)) {
      problems.push(
        `${target}: depends on ${dep} but ${project}'s package.json does not declare ${name ?? other}`,
      );
    }
  }
}
for (const [project, names] of packagesOf) {
  for (const name of names) {
    const other = projectOfPackage.get(name);
    if (!other || other === project || UNREACHED_ALLOWED.has(`${project}:${name}`)) continue;
    const reached = [...deps.keys()]
      .filter((target) => projectOf(target) === project)
      .some((target) => [...reach(target)].some((dep) => projectOf(dep) === other));
    if (!reached)
      problems.push(`${project}: declares ${name} but no task of it depends on ${other}`);
  }
}

if (problems.length > 0) {
  console.error(`moon graph: ${problems.length} problem(s), see .moon/AGENTS.md`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exitCode = 1;
} else {
  console.log("moon graph: ok - no duplicate edges, every cross-project edge is declared");
}
