/**
 * Guards the package-script contract (AGENTS.md, "Package scripts and Moon
 * tasks"): moon owns the task graph, and package.json scripts are its leaves.
 *
 * For every workspace package (and the repo root):
 *
 * - every script has a moon task of the same name, and that task's command is
 *   exactly `corepack pnpm run <name>`;
 * - every moon task runs its same-named script that way;
 * - no script starts a package manager or chains to another script
 *   (`pnpm run`/`exec`/`--filter`, `npm run`, `node --run`): a pnpm started
 *   from inside a pnpm script re-checks every workspace package and warns
 *   about the platform-specific server binaries;
 * - no `pre<name>`/`post<name>` hooks order work; ordering lives in moon deps;
 * - script names are kebab-case: moon task ids cannot contain `:`.
 *
 * The EXEMPT_* lists hold the deliberate exceptions. Shrink them; never grow
 * them without a reason next to the entry.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { parse } from "yaml";

/** Projects outside the contract. */
const EXEMPT_PROJECTS = new Set([
  // Go project; its tasks run go directly.
  "apps/server",
  // Standalone agent eval, deliberately not a moon project.
  "apps/cli-skill-e2e",
]);

/** Task ids exempt in every project. */
const EXEMPT_TASK_IDS = new Set([
  // Release orchestration: cleans dist, then runs the `build` script.
  "build-release",
]);

/** `<project>:<task>` entries that may run something other than their script. */
const EXEMPT_TASKS = new Set([
  // Orchestrators that start moon themselves. Launched through `pnpm run`,
  // the moon they start would inherit pnpm's environment and every task under
  // it would warn, so moon runs them with node directly.
  ".:cli",
  ".:server",
  ".:server-debug",
  ".:check",
  // The CI gate runs both Vitest projects through `test:all`.
  "packages/api-mock:test",
  "packages/components:test",
]);

/** `<project>:<script>` entries (`*` for any project) that need no task. */
const EXEMPT_SCRIPTS = new Set([
  // npm lifecycle hooks, run by `pnpm pack` and installs, not the task graph.
  "*:prepack",
  "*:postpack",
  "*:postinstall",
  // The entry points behind the orchestrator tasks above.
  ".:cli",
  ".:server",
  ".:check",
  // The Vitest lanes behind the test:all exceptions above.
  "packages/api-mock:test",
  "packages/api-mock:test:browser",
  "packages/api-mock:test:all",
  "packages/components:test",
  "packages/components:test:browser",
  "packages/components:test:all",
]);

const NPM_LIFECYCLE = new Set(["prepack", "postpack", "postinstall", "prepare", "preinstall"]);
const STARTS_RUNNER =
  /\b(?:pnpm|npm|yarn)\s+(?:run|exec|--filter|-F|-r|--recursive|--dir|-C)\b|\bnode\s+--run\b/;

function isHook(name, scripts) {
  if (NPM_LIFECYCLE.has(name)) return false;
  const match = /^(pre|post)(.+)$/.exec(name);
  // `preview` is only a hook when a `view` script exists.
  return match !== null && match[2] in scripts;
}

function exempt(set, dir, name) {
  return set.has(`${dir}:${name}`) || set.has(`*:${name}`);
}

/** Every violation of the contract for one project, as readable lines. */
export function checkProject(dir, scripts, tasks) {
  const problems = [];
  for (const [name, body] of Object.entries(scripts)) {
    if (STARTS_RUNNER.test(body)) {
      problems.push(`${dir}: script "${name}" starts a package manager: ${body}`);
    }
    if (isHook(name, scripts)) {
      problems.push(`${dir}: script "${name}" is a pre/post hook; order work with moon deps`);
    }
    if (exempt(EXEMPT_SCRIPTS, dir, name)) continue;
    if (name.includes(":")) {
      problems.push(`${dir}: script "${name}" must be kebab-case (moon task ids cannot contain ":")`);
    }
    if (!(name in tasks)) {
      problems.push(`${dir}: script "${name}" has no moon task of the same name`);
    }
  }
  for (const [id, task] of Object.entries(tasks)) {
    if (EXEMPT_TASK_IDS.has(id) || exempt(EXEMPT_TASKS, dir, id)) continue;
    const command = task?.command ?? task?.script;
    if (command !== `corepack pnpm run ${id}`) {
      problems.push(`${dir}: task "${id}" must run \`corepack pnpm run ${id}\`, not: ${command}`);
    }
  }
  return problems;
}

function projectDirs(root) {
  const dirs = [root];
  for (const group of ["apps", "packages"]) {
    for (const entry of readdirSync(join(root, group), { withFileTypes: true })) {
      const dir = join(group, entry.name);
      if (entry.isDirectory() && existsSync(join(root, dir, "package.json")) && !EXEMPT_PROJECTS.has(dir)) {
        dirs.push(dir);
      }
    }
  }
  return dirs;
}

export function checkWorkspace(root = ".") {
  const problems = [];
  for (const dir of projectDirs(root)) {
    const base = dir === root ? root : join(root, dir);
    const label = dir === root ? "." : dir;
    const scripts = JSON.parse(readFileSync(join(base, "package.json"), "utf8")).scripts ?? {};
    const moonPath = join(base, "moon.yml");
    const tasks = existsSync(moonPath) ? (parse(readFileSync(moonPath, "utf8"))?.tasks ?? {}) : {};
    problems.push(...checkProject(label, scripts, tasks));
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const problems = checkWorkspace();
  if (problems.length > 0) {
    console.error(`package scripts: ${problems.length} violation(s) of the AGENTS.md contract`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exitCode = 1;
  } else {
    console.log("package scripts: ok - every script is a moon task leaf");
  }
}
