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
  ".:journey",
  ".:check",
  "apps/cli-journey-e2e:e2e-local",
  "apps/cli-journey-e2e:e2e-testkit",
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
  ".:journey",
  ".:check",
  "apps/cli-journey-e2e:e2e-local",
  "apps/cli-journey-e2e:e2e-testkit",
  // The Vitest lanes behind the test:all exceptions above.
  "packages/api-mock:test",
  "packages/api-mock:test:browser",
  "packages/api-mock:test:all",
  "packages/components:test",
  "packages/components:test:browser",
  "packages/components:test:all",
]);

const NPM_LIFECYCLE = new Set(["prepack", "postpack", "postinstall", "prepare", "preinstall"]);
const PACKAGE_MANAGERS = new Set(["pnpm", "npm", "npx", "yarn", "corepack"]);

/**
 * Whether a script starts a package manager (or chains to another script with
 * `node --run`). The body is tokenized like a shell would: quotes are removed
 * but their text kept, and every simple command (split on newlines, `;`, `&`,
 * `|`, parentheses and braces) is checked after skipping shell keywords, env
 * assignments and an `env` wrapper (including `env -S '…'`). Command
 * substitutions run inside double quotes, so their bodies are checked too;
 * single-quoted text and escaped `\$` stay literal.
 */
export function startsPackageManager(body) {
  const live = body.replace(/'[^']*'/g, "''").replace(/\\\$/g, "");
  for (const [, dollar, backtick] of live.matchAll(/\$\(([^()]*)\)|`([^`]*)`/g)) {
    if (startsPackageManager(dollar ?? backtick)) return true;
  }
  return simpleCommands(body).some((words) => {
    const [command = "", next = ""] = commandWords(words);
    const executable = command.split("/").pop();
    return PACKAGE_MANAGERS.has(executable) || (executable === "node" && next === "--run");
  });
}

/** Split a shell command line into simple commands, each a list of words. */
function simpleCommands(text) {
  const commands = [];
  let words = [];
  let word = null;
  const endWord = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  const endCommand = () => {
    endWord();
    if (words.length > 0) commands.push(words);
    words = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === "'") {
      const close = text.indexOf("'", i + 1);
      const stop = close === -1 ? text.length : close;
      word = (word ?? "") + text.slice(i + 1, stop);
      i = stop;
    } else if (char === '"') {
      let j = i + 1;
      let quoted = "";
      while (j < text.length && text[j] !== '"') {
        if (text[j] === "\\" && j + 1 < text.length) {
          quoted += text[j + 1];
          j += 2;
        } else {
          quoted += text[j];
          j += 1;
        }
      }
      word = (word ?? "") + quoted;
      i = j;
    } else if (char === "\\" && i + 1 < text.length) {
      if (text[i + 1] !== "\n") word = (word ?? "") + text[i + 1];
      i += 1;
    } else if ("\n;&|(){}".includes(char)) {
      endCommand();
    } else if (/\s/.test(char)) {
      endWord();
    } else {
      word = (word ?? "") + char;
    }
  }
  endCommand();
  return commands;
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const KEYWORDS = new Set(["if", "then", "else", "elif", "do", "while", "until", "!", "time", "exec", "command", "nohup"]);

/**
 * The words of a simple command from its executable on: shell keywords and
 * env assignments are skipped, and an `env` wrapper is unwrapped (options,
 * `-u NAME`/`-C DIR` operands, assignments, and an `-S` string) so the
 * command it runs is the one checked.
 */
function commandWords(words) {
  let i = 0;
  while (i < words.length && (KEYWORDS.has(words[i]) || ASSIGNMENT.test(words[i]))) i += 1;
  if (words[i] !== "env") return words.slice(i);
  i += 1;
  while (i < words.length) {
    const word = words[i];
    if (word === "--") {
      i += 1;
      break;
    }
    if (word === "-S" || word === "--split-string") {
      return commandWords([...(simpleCommands(words[i + 1] ?? "")[0] ?? []), ...words.slice(i + 2)]);
    }
    if (word.startsWith("--split-string=")) {
      return commandWords([...(simpleCommands(word.slice(15))[0] ?? []), ...words.slice(i + 1)]);
    }
    if (word === "-u" || word === "-C" || word === "--unset" || word === "--chdir") {
      i += 2;
    } else if (word.startsWith("-") || ASSIGNMENT.test(word)) {
      i += 1;
    } else {
      break;
    }
  }
  return commandWords(words.slice(i));
}

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
    if (startsPackageManager(body)) {
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
    } else if (!(id in scripts)) {
      problems.push(`${dir}: task "${id}" runs a script "${id}" that does not exist`);
    }
  }
  return problems;
}

/**
 * Workspace project ids, `/`-separated on every platform so they match the
 * exemption keys; `join()` is only used for the filesystem paths.
 */
export function projectIds(root = ".") {
  const ids = ["."];
  for (const group of ["apps", "packages"]) {
    for (const entry of readdirSync(join(root, group), { withFileTypes: true })) {
      const id = `${group}/${entry.name}`;
      if (entry.isDirectory() && existsSync(join(root, group, entry.name, "package.json")) && !EXEMPT_PROJECTS.has(id)) {
        ids.push(id);
      }
    }
  }
  return ids;
}

export function checkWorkspace(root = ".") {
  const problems = [];
  for (const id of projectIds(root)) {
    const base = join(root, ...id.split("/"));
    const scripts = JSON.parse(readFileSync(join(base, "package.json"), "utf8")).scripts ?? {};
    const moonPath = join(base, "moon.yml");
    const tasks = existsSync(moonPath) ? (parse(readFileSync(moonPath, "utf8"))?.tasks ?? {}) : {};
    problems.push(...checkProject(id, scripts, tasks));
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
