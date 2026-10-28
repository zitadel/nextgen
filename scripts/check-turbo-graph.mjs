#!/usr/bin/env node
// Checks the turbo task graph against the rules in docs/design/build/
// turborepo.md, so a change cannot skip a task that reads it:
//
//   1. A file a task's code reads is an input. A repository file that an
//      import, an fs or path call, a //go:embed pattern or the task's command
//      names, in a code file the task runs, is hashed by the task, by a task
//      it depends on or by the global dependencies, or is a dependency's
//      output. A task runs its own package's files and what they import, not
//      every file it hashes (sdk-core's contract test reads other SDKs'
//      specs as text). What it runs of them depends on its kind: Biome,
//      gofmt and oclif read nothing a file names, a typecheck resolves
//      imports, a build also runs its configs and scripts, a test runs
//      everything. A Go file counts for the tasks of the module it belongs to.
//   2. A declared workspace package is built first. A package's build (for
//      dependencies and peerDependencies), typecheck and test (also for
//      devDependencies) reach that package's build.
//   3. No task hashes an ignored tree (node_modules, an agent's worktrees):
//      explicit globs match ignored files too.
//
// It reads the resolved graph from `turbo run <every task> --dry=json`.
// Usage: node scripts/check-turbo-graph.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import { TURBO_GRAPH_TASKS } from "./ci-mode.mjs";
import { isDirectRun } from "./dev-process.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

// Files a task's code names without reading them, each with why. Keys are
// `<task id>|<file>`; `<package>#*` matches every task of the package.
const embedOnly =
  "compiles the console's embed package and ships nothing built from it; vet, lint, test and build depend on @zitadel/console#build";
const spannerPackages =
  "the lane tests three packages (apps/server/package.json), not the cloud launcher, whose tests read it";
const REFERENCE_EXCEPTIONS = new Map([
  [
    "@zitadel/cli#test|apps/cli/AGENTS.md",
    "the eject tests write AGENTS.md into a temporary app; the CLI never reads its own",
  ],
  [
    "@zitadel/console#*|scripts/task-runner.mjs",
    "apps/console/scripts holds the dev:real launchers, which no build, test or typecheck program includes",
  ],
  ["@zitadel/server#openapi|internal/staticui/console/dist/.gitkeep", embedOnly],
  ["@zitadel/server#generate|internal/staticui/console/dist/.gitkeep", embedOnly],
  ["@zitadel/server#check-generate|internal/staticui/console/dist/.gitkeep", embedOnly],
  ["@zitadel/server#check-generate-pruned|internal/staticui/console/dist/.gitkeep", embedOnly],
  ["@zitadel/server#test-spanner|vercel.json", spannerPackages],
  ["@zitadel/server#test-spanner|apps/cloud/build.sh", spannerPackages],
]);

// Declared workspace packages a task does not build first, each with why.
// Keys are `<task id>|<package>`.
const serverWrapper =
  "only the runtime wrapper's launcher script is used (cli#test lists apps/server/bin), never the server build";
const devRealOnly = "dev:real resolves the kit from source; no build, test or typecheck imports it";
const laneTools =
  "the lanes run them, and each lane depends on their builds; the harness's unit tests and its typecheck import none of them";
const cliAtRunTime =
  "src/cli.ts resolves the CLI's bin at run time; the lanes that run the kit depend on @zitadel/cli#build";
const EDGE_EXCEPTIONS = new Map([
  ["@zitadel/cli#build|@zitadel/server", serverWrapper],
  ["@zitadel/cli#typecheck|@zitadel/server", serverWrapper],
  ["@zitadel/cli#test|@zitadel/server", serverWrapper],
  ["@zitadel/console#typecheck|@zitadel/testing", devRealOnly],
  ["@zitadel/console#test|@zitadel/testing", devRealOnly],
  [
    "@zitadel/docs#typecheck|@zitadel/cli",
    "the docs read the CLI's committed command-reference.json and CHANGELOG.md, which docs#generate lists",
  ],
  ["@zitadel/e2e#typecheck|@zitadel/api-mock", laneTools],
  ["@zitadel/e2e#typecheck|@zitadel/sdk-nuxt", laneTools],
  ["@zitadel/e2e#test|@zitadel/api", laneTools],
  ["@zitadel/e2e#test|@zitadel/api-mock", laneTools],
  ["@zitadel/e2e#test|@zitadel/config", laneTools],
  ["@zitadel/e2e#test|@zitadel/sdk-nuxt", laneTools],
  ["@zitadel/e2e#test|@zitadel/testing", laneTools],
  ["@zitadel/testing#build|@zitadel/cli", cliAtRunTime],
  ["@zitadel/testing#typecheck|@zitadel/cli", cliAtRunTime],
  ["@zitadel/testing#test|@zitadel/cli", cliAtRunTime],
  [
    "@zitadel/website#test|@zitadel/components",
    "its only spec parses changelog entries; the build and typecheck depend on @zitadel/components#build",
  ],
]);

// Ignored files a task hashes on purpose, as `<task id>|<file>` patterns.
const IGNORED_ALLOWED = [
  // The binary embeds the console's dist, so the build hashes its bytes.
  /^@zitadel\/server#build\|internal\/staticui\/console\/dist\//,
  // The console's build reads its .env files (Vite's loadEnv).
  /^@zitadel\/console#build\|apps\/console\/\.env/,
];

const CODE = /\.(?:[cm]?[jt]sx?|go)$/;
const TEST_FILE = /(?:^|\/)(?:tests?|__tests__)\/|\.(?:test|spec)\.[cm]?[jt]sx?$|_test\.go$/;
// What each kind of task runs of the code it hashes (rule 1).
const NO_READS = new Set(["lint", "format", "readme"]);
const IMPORTS_ONLY = new Set(["typecheck"]);
const BUILDS = new Set([
  "build",
  "build-release",
  "generate",
  "sync-schemas",
  "sync:export",
  "openapi",
  "check-generate",
  "check-generate-pruned",
  "clean-generated",
  "vet",
]);
// Calls whose string arguments name a file or folder to read.
const SCRIPT_READERS = new Set([
  "readFileSync",
  "readFile",
  "readdirSync",
  "readdir",
  "existsSync",
  "statSync",
  "stat",
  "lstatSync",
  "accessSync",
  "access",
  "createReadStream",
  "opendirSync",
  "cpSync",
  "copyFileSync",
  "globSync",
  "join",
  "resolve",
]);
const GO_READERS =
  /\b(?:os\.ReadFile|os\.Open|os\.ReadDir|os\.Stat|filepath\.Join|filepath\.Glob|fs\.ReadFile|fs\.Sub|template\.ParseFiles|template\.ParseGlob)\(/g;
// Top-level directories a repository-relative literal may start with.
const TOP_LEVEL = new Set([
  ".changeset",
  ".github",
  ".moon",
  "api",
  "apps",
  "biome-plugins",
  "cmd",
  "docs",
  "e2e",
  "examples",
  "internal",
  "packages",
  "scripts",
  "skills",
  "tools",
]);

/** The real tasks of a `--dry=json` summary, with repository-relative inputs. */
export function taskGraph(dry) {
  const tasks = new Map();
  for (const task of dry.tasks ?? []) {
    if (task.command === "<NONEXISTENT>") continue;
    const dir = task.directory ?? "";
    tasks.set(task.taskId, {
      id: task.taskId,
      packageName: task.package,
      task: task.task,
      dir,
      command: task.command ?? "",
      inputs: new Set(Object.keys(task.inputs ?? {}).map((file) => posix.join(dir, file))),
      outputs: (task.outputs ?? []).map((glob) => posix.normalize(posix.join(dir, glob))),
      dependencies: (task.dependencies ?? []).filter((id) => id !== task.taskId),
    });
  }
  return tasks;
}

/**
 * Whether a file is part of a task's result: hashed by it, by a task it
 * depends on or by the global dependencies, or written by a dependency.
 */
export function coverageOf(tasks, globalFiles = new Set()) {
  const memo = new Map();
  const walk = (id) => {
    if (memo.has(id)) return memo.get(id);
    const task = tasks.get(id);
    const entry = { files: new Set(task?.inputs ?? []), outputs: [] };
    memo.set(id, entry);
    for (const dep of task?.dependencies ?? []) {
      const inner = walk(dep);
      for (const file of inner.files) entry.files.add(file);
      entry.outputs.push(...(tasks.get(dep)?.outputs ?? []).map(outputPattern), ...inner.outputs);
    }
    return entry;
  };
  return (id) => {
    const { files, outputs } = walk(id);
    return (file) =>
      files.has(file) || globalFiles.has(file) || outputs.some((re) => re.test(file));
  };
}

const outputPatterns = new Map();
function outputPattern(glob) {
  if (!outputPatterns.has(glob)) {
    const source = glob
      .split("/")
      .map((part) => (part === "**" ? ".*" : globToRegExp(part)))
      .join("/")
      .replace(/\/\.\*$/, "(?:/.*)?");
    outputPatterns.set(glob, new RegExp(`^${source}$`));
  }
  return outputPatterns.get(glob);
}

/**
 * The paths a code file names, as `{ text, kind }`: `import` for a module
 * specifier, `read` for a string argument of an fs or path call, `embed` for
 * a //go:embed pattern. JavaScript and TypeScript go through the TypeScript
 * parser, so comments, regular expressions and plain data never produce one;
 * template literals contribute their constant parts.
 */
export function literalsOf(file, source) {
  return file.endsWith(".go") ? goLiterals(source) : scriptLiterals(file, source);
}

function textsOf(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isTemplateExpression(node)) {
    return [
      node.head.text,
      ...node.templateSpans.map((span) => span.literal.text.replace(/^\//, "")),
    ];
  }
  return [];
}

function calleeName(expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return "";
}

function scriptLiterals(file, source) {
  const kind = /\.[cm]?tsx$|\.jsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, kind);
  const out = [];
  const add = (node, as) => {
    for (const text of textsOf(node)) if (text) out.push({ text, kind: as });
  };
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      add(node.moduleSpecifier, "import");
    } else if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      const dynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      if (dynamicImport || name === "require" || name === "mock" || name === "importActual") {
        if (node.arguments[0]) add(node.arguments[0], "import");
      } else if (SCRIPT_READERS.has(name)) {
        for (const argument of node.arguments) add(argument, "read");
        // join("..", "x.json") names ../x.json.
        const parts = node.arguments.map((arg) => (ts.isStringLiteral(arg) ? arg.text : null));
        if ((name === "join" || name === "resolve") && parts.length > 1 && !parts.includes(null)) {
          out.push({ text: posix.join(...parts), kind: "read" });
        }
      }
    } else if (
      ts.isNewExpression(node) &&
      calleeName(node.expression) === "URL" &&
      node.arguments?.[0]
    ) {
      add(node.arguments[0], "read");
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return out;
}

function goLiterals(source) {
  const out = [];
  for (const match of source.matchAll(/^\/\/go:embed\s+(.+)$/gm)) {
    for (const pattern of match[1].trim().split(/\s+/)) {
      out.push({ text: pattern.replace(/^"|"$/g, "").replace(/^all:/, ""), kind: "embed" });
    }
  }
  // The string arguments of fs and path calls, up to the call's closing
  // parenthesis (calls nested in the arguments included), with the comments
  // blanked out first.
  source = source.replace(
    /"(?:[^"\\\n]|\\.)*"|`[^`]*`|'(?:[^'\\\n]|\\.)*'|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    (token) => (token.startsWith("/") ? token.replace(/[^\n]/g, " ") : token),
  );
  for (const match of source.matchAll(GO_READERS)) {
    let depth = 1;
    let index = match.index + match[0].length;
    const start = index;
    while (index < source.length && depth > 0) {
      const char = source[index];
      if (char === '"' || char === "`") {
        const close = char === "`" ? source.indexOf("`", index + 1) : findQuote(source, index + 1);
        if (close < 0) break;
        index = close;
      } else if (char === "(") depth++;
      else if (char === ")") depth--;
      index++;
    }
    const args = source.slice(start, index - 1);
    for (const literal of args.matchAll(/"((?:[^"\\\n]|\\.)*)"|`([^`]*)`/g)) {
      const text = literal[1] ?? literal[2];
      if (text) out.push({ text, kind: "read" });
    }
    // filepath.Join("..", "build.sh") names ../build.sh.
    const parts = args.split(",").map((part) => part.trim().match(/^"([^"\\]*)"$/)?.[1] ?? null);
    if (match[0] === "filepath.Join(" && parts.length > 1 && !parts.includes(null)) {
      out.push({ text: posix.join(...parts), kind: "read" });
    }
  }
  return out;
}

function findQuote(source, from) {
  for (let index = from; index < source.length; index++) {
    if (source[index] === "\\") index++;
    else if (source[index] === '"') return index;
    else if (source[index] === "\n") return -1;
  }
  return -1;
}

const PROBE = ["", ".ts", ".tsx", ".mts", ".js", ".mjs", "/index.ts", "/index.js"];

/**
 * The repository files and folders a literal in `file` names: relative to the
 * file, to its package (tests only: they read with the package as working
 * directory) and, for a path under a top-level folder, to the repository root.
 */
export function namedPaths(literal, { file, packageDir, tracked, folders }) {
  const text = literal.text.split(/[?#]/)[0];
  const embed = literal.kind === "embed";
  if (!text || text.includes("://") || text.startsWith("/")) return [];
  if (text.includes("*") && !embed) return [];
  if (text === "." || text === ".." || text === "./" || text === "../") return [];
  const relative = text.startsWith("./") || text.startsWith("../");
  const bases = [posix.dirname(file)];
  if (!relative && TEST_FILE.test(file)) bases.push(packageDir);
  if (!relative && TOP_LEVEL.has(text.split("/")[0]) && text.includes("/")) bases.push("");
  if (!relative && !text.includes("/") && !/\.[a-z0-9]+$/i.test(text) && !embed) return [];
  const found = new Map();
  for (const base of bases) {
    const path = posix.normalize(posix.join(base, text));
    if (path.startsWith("..")) continue;
    if (embed) {
      const pattern = new RegExp(`^${globToRegExp(path)}(?:/|$)`);
      for (const candidate of tracked) if (pattern.test(candidate)) found.set(candidate, false);
      continue;
    }
    const probes = relative ? PROBE : [""];
    const hit = probes.map((suffix) => path + suffix).find((candidate) => tracked.has(candidate));
    if (hit) found.set(hit, false);
    else if (folders.has(path) && path !== packageDir && path !== "") found.set(path, true);
  }
  return [...found].map(([path, folder]) => ({ path, folder }));
}

function globToRegExp(glob) {
  return glob
    .split("")
    .map((char) =>
      char === "*" ? "[^/]*" : char === "?" ? "[^/]" : char.replace(/[.+^${}()|[\]\\]/g, "\\$&"),
    )
    .join("");
}

function packageDirOf(file, packageDirs) {
  let best = "";
  for (const dir of packageDirs) {
    if (dir && (file === dir || file.startsWith(`${dir}/`)) && dir.length > best.length) best = dir;
  }
  return best;
}

// The nearest folder with a go.mod: a Go file belongs to that module.
function moduleOf(file, modules) {
  for (let dir = posix.dirname(file); ; dir = posix.dirname(dir)) {
    const key = dir === "." ? "" : dir;
    if (modules.has(key)) return key;
    if (key === "") return null;
  }
}

// Files a test runner starts from besides the tests: its configs and setup.
const TEST_ENTRY =
  /(?:^|\/)(?:vitest|vite|playwright)[^/]*\.config\.[cm]?[jt]s$|(?:^|\/)[^/]*setup[^/]*\.[cm]?[jt]sx?$/i;

/**
 * The code files a task runs, followed through their imports: a typecheck
 * starts from every file of its package it hashes, a build from those that
 * are not tests, any other task (tests, lanes, checks) from its tests, its
 * runner's configs and the files its command names, or from every file when
 * it has none of those. A root task starts from what its command names: the
 * root package's folder is the repository, so its inputs say what it hashes,
 * not what it runs. A Go file belongs to the tasks of its module.
 */
function runSetOf(task, { tracked, namesOf, modulePackages, commandFiles }) {
  const own = (file) =>
    file.endsWith(".go")
      ? modulePackages.get(moduleOf(file, modulePackages)) === task.packageName
      : task.dir === "" || file.startsWith(`${task.dir}/`);
  const hashed = [...task.inputs].filter(
    (file) => CODE.test(file) && tracked.has(file) && own(file),
  );
  let roots = hashed;
  if (task.dir === "") {
    roots = [];
  } else if (BUILDS.has(task.task)) {
    roots = hashed.filter((file) => !TEST_FILE.test(file));
  } else if (!IMPORTS_ONLY.has(task.task)) {
    const entries = hashed.filter(
      (file) =>
        file.endsWith(".go") ||
        TEST_FILE.test(file) ||
        TEST_ENTRY.test(file) ||
        commandFiles.has(file),
    );
    if (entries.length > 0) roots = entries;
  }
  const pending = [...roots, ...commandFiles];
  const seen = new Set();
  while (pending.length > 0) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const ref of namesOf(file)) {
      if (ref.kind === "import" && !ref.folder && CODE.test(ref.path)) pending.push(ref.path);
    }
  }
  return [...seen].sort();
}

/** Whether a task of `kind` runs what `ref` names from `file`. */
function runs(kind, file, ref) {
  if (NO_READS.has(kind)) return false;
  if (IMPORTS_ONLY.has(kind)) return ref.kind === "import";
  if (BUILDS.has(kind)) return ref.kind !== "read" || !TEST_FILE.test(file);
  return true;
}

/** Rule 1: files a task's code or command reads that are not part of its result. */
export function referenceProblems(
  tasks,
  {
    tracked,
    read,
    globalFiles = new Set(),
    modulePackages = new Map(),
    exceptions = REFERENCE_EXCEPTIONS,
  },
) {
  const folders = new Set();
  for (const file of tracked) {
    for (
      let dir = posix.dirname(file);
      dir !== "." && !folders.has(dir);
      dir = posix.dirname(dir)
    ) {
      folders.add(dir);
    }
  }
  const packageDirs = new Set([...tasks.values()].map((task) => task.dir));
  const named = new Map();
  const namesOf = (file) => {
    if (!named.has(file)) {
      const source = read(file);
      const packageDir = packageDirOf(file, packageDirs);
      named.set(
        file,
        source === null
          ? []
          : literalsOf(file, source).flatMap((literal) =>
              namedPaths(literal, { file, packageDir, tracked, folders }).map((path) => ({
                ...path,
                literal: literal.text,
                kind: literal.kind,
              })),
            ),
      );
    }
    return named.get(file);
  };
  const covered = coverageOf(tasks, globalFiles);
  const problems = [];
  for (const task of tasks.values()) {
    if (NO_READS.has(task.task)) continue;
    const isCovered = covered(task.id);
    const excepted = (path) =>
      exceptions.has(`${task.id}|${path}`) || exceptions.has(`${task.packageName}#*|${path}`);
    const report = (path, from, literal) => {
      const problem = `${task.id}: ${from} reads ${path} ("${literal}"), which is not part of its result`;
      if (!problems.includes(problem)) problems.push(problem);
    };
    const commandRefs = task.command
      .split(/[\s"'=]+/)
      .filter((word) => word.includes("/") && !word.startsWith("-"))
      .flatMap((word) =>
        namedPaths(
          { text: word, kind: "read" },
          {
            file: posix.join(task.dir, "package.json"),
            packageDir: task.dir,
            tracked,
            folders,
          },
        ).map((ref) => ({ ...ref, literal: word })),
      );
    const commandFiles = new Set(
      commandRefs.filter((ref) => !ref.folder && CODE.test(ref.path)).map((ref) => ref.path),
    );
    const sources = runSetOf(task, { tracked, namesOf, modulePackages, commandFiles });
    for (const file of sources) {
      for (const ref of namesOf(file)) {
        if (!runs(task.task, file, ref)) continue;
        if (ref.folder) {
          const prefix = `${ref.path}/`;
          const inFolder = [...tracked].filter((candidate) => candidate.startsWith(prefix));
          if (inFolder.some(isCovered) || excepted(ref.path)) continue;
          report(`${ref.path}/`, file, ref.literal);
        } else if (!isCovered(ref.path) && !excepted(ref.path)) {
          report(ref.path, file, ref.literal);
        }
      }
    }
    for (const ref of commandRefs) {
      if (!ref.folder && !isCovered(ref.path) && !excepted(ref.path)) {
        report(ref.path, "its command", ref.literal);
      }
    }
  }
  return problems;
}

/** Rule 2: declared workspace packages a task does not build first. */
export function edgeProblems(tasks, manifests, exceptions = EDGE_EXCEPTIONS) {
  const reach = new Map();
  const reached = (id) => {
    if (reach.has(id)) return reach.get(id);
    const seen = new Set();
    reach.set(id, seen);
    for (const dep of tasks.get(id)?.dependencies ?? []) {
      seen.add(dep);
      for (const next of reached(dep)) seen.add(next);
    }
    return seen;
  };
  const problems = [];
  for (const [packageName, manifest] of manifests) {
    const workspace = (deps) =>
      Object.entries(deps ?? {})
        .filter(([, version]) => String(version).startsWith("workspace:"))
        .map(([name]) => name);
    const runtime = [...workspace(manifest.dependencies), ...workspace(manifest.peerDependencies)];
    const all = [...runtime, ...workspace(manifest.devDependencies)];
    for (const [taskName, needs] of [
      ["build", runtime],
      ["typecheck", all],
      ["test", all],
    ]) {
      const id = `${packageName}#${taskName}`;
      if (!tasks.has(id)) continue;
      for (const dep of new Set(needs)) {
        const build = `${dep}#build`;
        if (dep === packageName || !tasks.has(build) || reached(id).has(build)) continue;
        if (exceptions.has(`${id}|${dep}`)) continue;
        problems.push(`${id}: declares ${dep} but does not depend on ${build}`);
      }
    }
  }
  return problems;
}

/** Rule 3: ignored files in a task's inputs that no listed exception allows. */
export function ignoredProblems(tasks, ignored, allowed = IGNORED_ALLOWED) {
  const problems = [];
  for (const task of tasks.values()) {
    const hashed = [...task.inputs].filter(
      (file) => ignored.has(file) && !allowed.some((pattern) => pattern.test(`${task.id}|${file}`)),
    );
    if (hashed.length > 0) {
      problems.push(
        `${task.id}: hashes ${hashed.length} ignored file(s), e.g. ${hashed.slice(0, 3).join(", ")}`,
      );
    }
  }
  return problems;
}

function git(args, input) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    input,
    maxBuffer: 256 * 1024 * 1024,
  });
}

function main() {
  const turbo = posix.join(root, "node_modules", ".bin", "turbo");
  const dry = JSON.parse(
    execFileSync(existsSync(turbo) ? turbo : "turbo", ["run", ...TURBO_GRAPH_TASKS, "--dry=json"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, TURBO_TELEMETRY_DISABLED: "1" },
      maxBuffer: 512 * 1024 * 1024,
    }),
  );
  const tasks = taskGraph(dry);
  const tracked = new Set(git(["ls-files", "-z"]).split("\0").filter(Boolean));
  const read = (file) => {
    try {
      return readFileSync(posix.join(root, file), "utf8");
    } catch {
      return null;
    }
  };
  const manifests = new Map();
  for (const task of tasks.values()) {
    if (task.packageName === "//" || manifests.has(task.packageName)) continue;
    manifests.set(task.packageName, JSON.parse(read(posix.join(task.dir, "package.json")) ?? "{}"));
  }
  const inputs = [...new Set([...tasks.values()].flatMap((task) => [...task.inputs]))];
  // Exit 1 means none of them is ignored.
  const check = spawnSync("git", ["check-ignore", "--stdin", "-z"], {
    cwd: root,
    encoding: "utf8",
    input: inputs.join("\0"),
    maxBuffer: 256 * 1024 * 1024,
  });
  if (check.status !== 0 && check.status !== 1) {
    throw new Error(`git check-ignore failed: ${check.stderr}`);
  }
  const ignored = new Set(check.stdout.split("\0").filter(Boolean));

  const globalFiles = new Set(Object.keys(dry.globalCacheInputs?.files ?? {}));
  // The root module is the server's; tools/bench and tools/oidc-mock are modules of their own.
  const modulePackages = new Map();
  for (const file of tracked) {
    if (posix.basename(file) !== "go.mod") continue;
    const dir = posix.dirname(file) === "." ? "" : posix.dirname(file);
    const owner =
      dir === ""
        ? "@zitadel/server"
        : [...tasks.values()].find((task) => task.dir === dir)?.packageName;
    if (owner) modulePackages.set(dir, owner);
  }
  const problems = [
    ...referenceProblems(tasks, { tracked, read, globalFiles, modulePackages }),
    ...edgeProblems(tasks, manifests),
    ...ignoredProblems(tasks, ignored),
  ];
  if (problems.length > 0) {
    for (const problem of problems) console.error(`turbo graph: ${problem}`);
    console.error(
      `turbo graph: ${problems.length} problem(s). Add the file to the task's inputs (docs/design/build/turborepo.md), the edge to its dependsOn, or an exception with the reason (scripts/check-turbo-graph.mjs).`,
    );
    process.exit(1);
  }
  console.log(
    `turbo graph: ok - ${tasks.size} tasks; every file their code names is hashed, every declared package is built first, no ignored tree is hashed`,
  );
}

if (isDirectRun(import.meta.url)) {
  main();
}
