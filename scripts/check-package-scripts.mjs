/**
 * Guards the package-script contract (AGENTS.md, "Package scripts and Moon
 * tasks"): moon orders work across packages, and a package's scripts only
 * ever do that package's own work.
 *
 * For every workspace package (and the repo root), no script:
 *
 * - starts a package manager or moon (`pnpm run`/`exec`/`--filter`,
 *   `npm run`, `npx`, `moon run`): a pnpm started from inside a pnpm script
 *   re-checks every workspace package and warns about the platform-specific
 *   server binaries, and a nested moon hides a task edge from the graph;
 * - changes into another directory outside the package (`cd ../api`) to do
 *   that package's work, which belongs in a moon dep;
 * - uses shell constructs that would let either hide from these checks.
 *
 * A script may chain the package's own scripts with `node --run` and pre/post
 * hooks: ordering inside one package is the package's business.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** `<project>:<script>` entries allowed to leave their package. */
const EXEMPT_SCRIPTS = new Set([
  // The Vercel build: vercel.json runs it with only this package's dependency
  // closure installed (no moon), so it builds api, config and api-mock itself.
  "apps/mock-zitadel:build:vercel",
]);

// Moon too: a script that starts moon hides a task edge from the graph.
const PACKAGE_MANAGERS = new Set([
  "pnpm",
  "pnpx",
  "npm",
  "npx",
  "yarn",
  "corepack",
  "bun",
  "bunx",
  "moon",
]);

/** A package manager's (or moon's) entry file, started with node directly. */
const PACKAGE_MANAGER_ENTRY =
  /(?:^|[\\/])node_modules[\\/](?:pnpm|npm|yarn|corepack|bun|@moonrepo[\\/]cli)[\\/]|(?:^|[\\/])(?:pnpm|pnpx|npm-cli|npx-cli|yarn|corepack)\.(?:c?js|mjs)$/i;

/**
 * Whether a script starts a package manager or moon. `node --run` is not one:
 * it runs a script of the same package without starting pnpm. The body is
 * tokenized like a shell would: quotes are removed but their text kept, and every simple command (split on newlines, `;`, `&`,
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
    if (executable === "node") return nodeRunsPackageManager(args);
    return PACKAGE_MANAGERS.has(executable);
  });
}

/** Node options that take the following argument as their value. */
const NODE_VALUE_OPTIONS = new Set([
  "-r",
  "--require",
  "--import",
  "--loader",
  "--experimental-loader",
  "-C",
  "--conditions",
  "--env-file",
  "--title",
]);

/**
 * Whether node's script argument is a package manager's entry file, or a
 * variable (`node "$npm_execpath" install` starts whichever one ran the script).
 */
function nodeRunsPackageManager(args) {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "-e" || arg === "--eval" || arg === "-p") return false;
    if (!arg.startsWith("-")) return arg.includes("$") || PACKAGE_MANAGER_ENTRY.test(arg);
    if (NODE_VALUE_OPTIONS.has(arg)) i += 1;
  }
  return false;
}

const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "mksh", "ash", "fish", "csh", "tcsh"]);

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

const EVALUATORS = new Set(["eval", "source", ".", "trap", "coproc"]);

/** Windows shells, whose command strings this guard does not parse. */
const WINDOWS_SHELLS = new Set(["cmd", "powershell", "pwsh"]);

/** Commands that run another command; a script runs its tool directly. */
const COMMAND_RUNNERS = new Set([
  "timeout",
  "xargs",
  "nice",
  "ionice",
  "stdbuf",
  "sudo",
  "doas",
  "setsid",
  "flock",
  "taskset",
  "chronic",
  "unbuffer",
  "parallel",
  "watch",
  "caffeinate",
  "script",
  "busybox",
  // Toolchain launchers: each starts the command it is given.
  "devbox",
  "proto",
  // Env loaders and script runners: each starts the command (or the package
  // scripts) it is given.
  "cross-env",
  "dotenv",
  "run-s",
  "run-p",
  "npm-run-all",
  "npm-run-all2",
  "concurrently",
]);

/**
 * Shell constructs a package script has no use for, and that would let a
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
    } else if (
      (char === "<" || char === ">") &&
      word !== null &&
      !/^\d+$/.test(word) &&
      !/[<>&]$/.test(word)
    ) {
      // A redirection attached to a word (`pnpm>out.log`) starts a new token;
      // a bare descriptor number (`2>`) stays with it.
      endWord();
      word = char;
    } else if (char === "&" && (/[<>]/.test(text[i - 1] ?? "") || text[i + 1] === ">")) {
      // Part of a redirection (`2>&1`, `<&3`, `&> log`), not a separator. An
      // `&>` attached to a word (`pnpm&>out.log`) starts a new token.
      if (text[i + 1] === ">" && word !== null && !/[<>&]$/.test(word)) endWord();
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
const KEYWORDS = new Set([
  "if",
  "then",
  "else",
  "elif",
  "do",
  "while",
  "until",
  "!",
  "time",
  "exec",
  "command",
  "builtin",
  "nohup",
]);

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
      const takesValue =
        (wrapper === "exec" && words[i] === "-a") ||
        (wrapper === "time" && ["-f", "--format", "-o", "--output"].includes(words[i]));
      i += takesValue ? 2 : 1;
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
      return commandWords([
        ...(simpleCommands(words[i + 1] ?? "")[0] ?? []),
        ...words.slice(i + 2),
      ]);
    }
    if (word.startsWith("--split-string=")) {
      return commandWords([...(simpleCommands(word.slice(15))[0] ?? []), ...words.slice(i + 1)]);
    }
    if (["-u", "-C", "-P", "--unset", "--chdir"].includes(word)) {
      i += 2;
    } else if (word.startsWith("-") || ASSIGNMENT.test(word)) {
      i += 1;
    } else {
      break;
    }
  }
  return commandWords(words.slice(i));
}

/** A directory outside the package: a parent, an absolute path, or one only known at run time. */
function outsidePackage(dir) {
  return (
    /^(?:\.\.(?:[\\/]|$)|[\\/]|~|[A-Za-z]:[\\/]|\$)/.test(dir) || /[\\/]\.\.(?:[\\/]|$)/.test(dir)
  );
}

/**
 * Whether a script changes into a directory outside its package: `cd`/`pushd`
 * to one, or an `env -C`/`--chdir` wrapper that runs its command there.
 */
export function leavesPackage(body) {
  return simpleCommands(body).some((raw) => {
    // CDPATH makes a relative `cd` resolve against other directories.
    if (raw.some((word) => word.startsWith("CDPATH="))) return true;
    for (let i = 0; i < raw.length; i += 1) {
      if (executableName(raw[i]) !== "env") continue;
      for (let j = i + 1; j < raw.length; j += 1) {
        const word = raw[j];
        if (word === "-C" || word === "--chdir") {
          if (outsidePackage(raw[j + 1] ?? "")) return true;
          j += 1;
        } else if (/^-C./.test(word) || word.startsWith("--chdir=")) {
          if (outsidePackage(word.slice(word.startsWith("-C") ? 2 : 8))) return true;
        } else if (["-u", "-P", "--unset"].includes(word)) {
          j += 1;
        } else if (!word.startsWith("-") && !ASSIGNMENT.test(word)) break;
      }
    }
    const [command = "", ...args] = commandWords(raw);
    if (!["cd", "pushd"].includes(executableName(command))) return false;
    const target = args.find((arg) => !/^-[LPen@]+$/.test(arg) && arg !== "--");
    // A bare `cd` goes to $HOME.
    return target === undefined || outsidePackage(target);
  });
}

/** Every violation of the contract for one project, as readable lines. */
export function checkProject(dir, scripts) {
  const problems = [];
  for (const [name, body] of Object.entries(scripts)) {
    const unsupported = unsupportedSyntax(body);
    if (unsupported) {
      problems.push(`${dir}: script "${name}" uses ${unsupported}; keep scripts to plain commands`);
    }
    if (startsPackageManager(body)) {
      problems.push(`${dir}: script "${name}" starts a package manager or moon: ${body}`);
    }
    if (leavesPackage(body) && !EXEMPT_SCRIPTS.has(`${dir}:${name}`)) {
      problems.push(
        `${dir}: script "${name}" changes into another directory; order other packages' work with moon deps`,
      );
    }
  }
  return problems;
}

/**
 * Workspace project ids, `/`-separated on every platform so problems read the
 * same everywhere; `join()` is only used for the filesystem paths.
 */
export function projectIds(root = ".") {
  const ids = ["."];
  for (const group of ["apps", "packages"]) {
    for (const entry of readdirSync(join(root, group), { withFileTypes: true })) {
      const id = `${group}/${entry.name}`;
      if (entry.isDirectory() && existsSync(join(root, group, entry.name, "package.json"))) {
        ids.push(id);
      }
    }
  }
  return ids;
}

export function checkWorkspace(root = ".") {
  const problems = [];
  for (const id of projectIds(root)) {
    const manifest = join(root, ...id.split("/"), "package.json");
    const scripts = JSON.parse(readFileSync(manifest, "utf8")).scripts ?? {};
    problems.push(...checkProject(id, scripts));
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
    console.log("package scripts: ok - every script stays inside its package");
  }
}
