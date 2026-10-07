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
  if (substitutions(body).some(startsPackageManager)) return true;
  return simpleCommands(body).some((words) => {
    const [command = "", ...args] = commandWords(words);
    const executable = executableName(command);
    if (SHELLS.has(executable)) {
      // `-c`, alone or grouped (`-lc`, `-ec`): the next argument is the script.
      const flag = args.findIndex((arg) => /^-[A-Za-z]*c[A-Za-z]*$/.test(arg));
      return flag !== -1 && startsPackageManager(args[flag + 1] ?? "");
    }
    if (executable === "node") return nodeRunsScript(args);
    return PACKAGE_MANAGERS.has(executable);
  });
}

/** Node options that take the following argument as their value. */
const NODE_VALUE_OPTIONS = new Set(["-r", "--require", "--import", "--loader", "--experimental-loader", "-C", "--conditions", "--env-file", "--title"]);

/**
 * Whether node's own options include `--run` (`--run build`, `--run=build`),
 * before the script path: after it, `--run` is just an argument to the script.
 */
function nodeRunsScript(args) {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--run" || arg.startsWith("--run=")) return true;
    if (!arg.startsWith("-") || arg === "--" || arg === "-e" || arg === "--eval" || arg === "-p") return false;
    if (NODE_VALUE_OPTIONS.has(arg)) i += 1;
  }
  return false;
}

const SHELLS = new Set(["sh", "bash", "zsh", "dash"]);

/**
 * A command word's program name: its basename (either path separator),
 * lowercased, without a Windows launcher extension (`pnpm.cmd`, `node.exe`).
 */
export function executableName(word) {
  return word
    .split(/[\\/]/)
    .pop()
    .toLowerCase()
    .replace(/\.(?:cmd|exe|bat|ps1)$/, "");
}

/**
 * The bodies of the command substitutions (`$(…)`, backticks) a shell would
 * run: outside quotes and inside double quotes, but not inside single quotes
 * (which are only literal outside double quotes) or after a backslash.
 */
function substitutions(text) {
  const bodies = [];
  let inDouble = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === "\\") {
      i += 1;
    } else if (char === "'" && !inDouble) {
      const close = text.indexOf("'", i + 1);
      i = close === -1 ? text.length : close;
    } else if (char === '"') {
      inDouble = !inDouble;
    } else if (char === "$" && text[i + 1] === "(") {
      let depth = 1;
      let j = i + 2;
      while (j < text.length && depth > 0) {
        if (text[j] === "(") depth += 1;
        else if (text[j] === ")") depth -= 1;
        j += 1;
      }
      bodies.push(text.slice(i + 2, j - 1));
      i = j - 1;
    } else if (char === "`") {
      const close = text.indexOf("`", i + 1);
      const stop = close === -1 ? text.length : close;
      bodies.push(text.slice(i + 1, stop));
      i = stop;
    }
  }
  return bodies;
}

const EVALUATORS = new Set(["eval", "source", ".", "trap"]);

/** Windows shells, whose command strings this guard does not parse. */
const WINDOWS_SHELLS = new Set(["cmd", "powershell", "pwsh"]);

/** Commands that run another command; a script runs its tool directly. */
const COMMAND_RUNNERS = new Set([
  "timeout", "xargs", "nice", "ionice", "stdbuf", "sudo", "doas", "setsid", "flock",
  "taskset", "chronic", "unbuffer", "parallel", "watch", "caffeinate", "script",
]);

/**
 * Shell constructs a single-step script has no use for, and that would let a
 * nested package manager hide from the checks above: command substitution,
 * `eval`/`source`, and inline `sh -c` scripts. Returns a description, or null.
 */
export function unsupportedSyntax(body) {
  if (substitutions(body).length > 0) return "command substitution";
  for (const words of simpleCommands(body)) {
    const [command = "", ...args] = commandWords(words);
    const executable = executableName(command);
    if (EVALUATORS.has(executable)) return `\`${executable}\``;
    if (COMMAND_RUNNERS.has(executable)) return `the command wrapper \`${executable}\``;
    if (WINDOWS_SHELLS.has(executable)) return `the Windows shell \`${executable}\``;
    if (command.includes("$")) return "a variable in the command position";
    if (SHELLS.has(executable) && args.some((arg) => /^-[A-Za-z]*c[A-Za-z]*$/.test(arg))) {
      return `an inline \`${executable} -c\` script`;
    }
  }
  return null;
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
        // Inside double quotes a backslash only escapes $ ` " \ and newline.
        if (text[j] === "\\" && j + 1 < text.length && '$`"\\\n'.includes(text[j + 1])) {
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
    } else if ((char === "<" || char === ">") && word !== null && !/^\d+$/.test(word) && !/[<>&]$/.test(word)) {
      // A redirection attached to a word (`pnpm>out.log`) starts a new token;
      // a bare descriptor number (`2>`) stays with it.
      endWord();
      word = char;
    } else if (char === "&" && (/[<>]/.test(text[i - 1] ?? "") || text[i + 1] === ">")) {
      // Part of a redirection (`2>&1`, `<&3`, `&> log`), not a separator.
      word = (word ?? "") + char;
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
const REDIRECTION = /^\d*(?:>>?|<<?|>&|<&|&>>?)(.*)$/;

function commandWords(input) {
  // Redirections (`2>/dev/null`, `> out.log`) can appear anywhere, even before
  // the executable; drop them and, for a bare operator, its target.
  const words = [];
  for (let j = 0; j < input.length; j += 1) {
    const redirect = REDIRECTION.exec(input[j]);
    if (redirect) {
      if (redirect[1] === "") j += 1;
    } else {
      words.push(input[j]);
    }
  }
  let i = 0;
  while (i < words.length && (KEYWORDS.has(words[i]) || ASSIGNMENT.test(words[i]))) {
    const wrapper = KEYWORDS.has(words[i]) ? words[i] : null;
    i += 1;
    // `exec -- cmd`, `time -p cmd`, `command -p cmd`: options belong to the
    // wrapper; `exec -a NAME` also takes the following word.
    while (wrapper && i < words.length && words[i].startsWith("-")) {
      i += wrapper === "exec" && words[i] === "-a" ? 2 : 1;
    }
  }
  if (executableName(words[i] ?? "") !== "env") return words.slice(i);
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
    const unsupported = unsupportedSyntax(body);
    if (unsupported) {
      problems.push(`${dir}: script "${name}" uses ${unsupported}; keep scripts to plain commands`);
    }
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
