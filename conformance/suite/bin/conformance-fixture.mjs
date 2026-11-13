#!/usr/bin/env node
// Generates a conformance fixture the way a customer gets the app, and checks
// that the committed one is still what the CLI's scaffolding produces.
//
//   conformance-fixture generate   rewrite the fixture in the current directory
//   conformance-fixture check      regenerate into a temp dir and diff; exit 1 on drift
//
// Both run the built CLI's `setup` (which runs the framework's own generator
// at the version the CLI pins) in an empty temp directory, against a server
// booted on the fixture's `generatePort`, then normalize the result (below).
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";

import { bootLocalServer } from "@zitadel/testing";
import semver from "semver";

const require = createRequire(import.meta.url);
const workspaceRoot = join(import.meta.dirname, "..", "..", "..");
const cliBin = join(dirname(require.resolve("@zitadel/cli/package.json")), "bin", "run.js");

/** Files a fixture carries beside the generated app: the lane's own. */
const HARNESS_FILES = new Set(["playwright.config.mts", "conformance.spec.ts", "turbo.json"]);

/**
 * What setup leaves in the app that the fixture does not commit, for every
 * framework: install output; the secret and the env files that hold it;
 * the CLI's own state, which the app never reads (`zitadel.json`,
 * `.zitadel/`); the docs setup writes for a person; and editor and
 * package-manager settings, which pnpm and the workspace own.
 */
const DROPPED_DIRS = ["node_modules", ".svelte-kit", ".zitadel", ".vscode"];
const DROPPED_FILES = new Set([
  "package-lock.json",
  ".npmrc",
  "zitadel.json",
  "AGENTS.md",
  "README.md",
]);

function isDropped(path) {
  const [first] = path.split("/");
  if (DROPPED_DIRS.includes(first)) return true;
  if (DROPPED_FILES.has(path)) return true;
  return first.startsWith(".env") && path !== ".env.example";
}

/**
 * The generated scripts the fixture keeps: `dev`, which the lane runs, and
 * the generator's own type-check as `typecheck`, which compiles the pages
 * setup wrote against the SDK's types. That is a `check` script where the
 * generator writes one (sv), else the `tsc -b` its `build` starts with
 * (create-vite).
 */
function keptScripts(scripts) {
  const kept = {};
  if (scripts.dev) kept.dev = scripts.dev;
  if (scripts.check) {
    kept.typecheck = scripts.check;
  } else if (/^tsc -b(?:\s|$)/.test(scripts.build ?? "")) {
    kept.typecheck = "tsc -b";
  }
  return kept;
}

async function main() {
  const mode = process.argv[2];
  if (mode !== "generate" && mode !== "check") {
    throw new Error("usage: conformance-fixture <generate|check>");
  }
  const fixtureDir = process.cwd();
  const manifest = JSON.parse(await readFile(join(fixtureDir, "package.json"), "utf8"));
  const settings = manifest.conformance;
  if (!settings) throw new Error(`${fixtureDir}/package.json has no "conformance" field`);

  // A generator its pin does not fix (it reads a template from GitHub or asks
  // npm for `latest`) can drift with no change here: its fixture's check runs
  // only where CONFORMANCE_UNPINNED is true, the nightly run (ci.yml).
  if (mode === "check" && settings.generatorPinned === false) {
    if (process.env.CONFORMANCE_UNPINNED !== "true") {
      console.log(`${manifest.name}: its generator is not fixed by its pin; checked nightly only`);
      return;
    }
  }

  const work = await mkdtemp(join(tmpdir(), `zitadel-conformance-${settings.framework}-`));
  try {
    const generated = await generate(work, settings, manifest.name);
    if (mode === "generate") {
      await write(fixtureDir, generated);
    } else {
      await check(fixtureDir, work, generated, manifest.name);
    }
  } finally {
    if (process.env.CONFORMANCE_KEEP_WORK_DIR !== "1") {
      await rm(work, { recursive: true, force: true });
    }
  }
}

/** Runs setup in `<work>/app` and returns the normalized files by path. */
async function generate(work, settings, name) {
  const app = join(work, "app");
  await mkdir(app);
  const server = await bootLocalServer({
    port: settings.generatePort,
    dir: join(work, "server"),
    serverBinary:
      process.env.ZITADEL_SERVER_BINARY ?? join(workspaceRoot, "dist", "server", "nextgen"),
  });
  try {
    const args = [
      cliBin,
      "setup",
      "--framework",
      settings.framework,
      "--server",
      server.baseUrl,
      "--dev-port",
      String(settings.appPort),
      "--non-interactive",
      "--json",
      "--no-git",
      "--skip-install",
    ];
    const result = spawnSync(process.execPath, args, {
      cwd: app,
      env: setupEnv(),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    const envelope = parseEnvelope(result.stdout);
    if (result.status !== 0 || envelope?.status !== "ok") {
      throw new Error(
        `zitadel setup --framework ${settings.framework} failed (exit ${result.status}):\n${result.stdout}\n${result.stderr}`,
      );
    }
  } finally {
    await server.stop();
  }

  const files = new Map();
  for (const path of await listFiles(app)) {
    if (isDropped(path)) continue;
    files.set(path, await readFile(join(app, path)));
  }
  const packageJson = files.get("package.json");
  if (!packageJson) throw new Error("setup wrote no package.json");
  files.set(
    "package.json",
    Buffer.from(await normalizeManifest(packageJson.toString("utf8"), settings, name)),
  );
  return files;
}

/**
 * The generated package.json, made a workspace package: the fixture's name,
 * the scripts it keeps and the lane's, the workspace's own Zitadel packages,
 * the pnpm catalog for every dependency it holds (the repo's rule), and the
 * lane's harness dependencies.
 */
async function normalizeManifest(text, settings, name) {
  const generated = JSON.parse(text);
  const catalog = await readCatalog();
  const indent = text.startsWith("{\n\t") ? "\t" : 2;
  const {
    name: _name,
    private: _private,
    version,
    scripts = {},
    dependencies,
    devDependencies,
    ...rest
  } = generated;
  const behind = [];
  const mapped = (deps = {}) =>
    Object.fromEntries(
      Object.entries(deps)
        .map(([dep, range]) => [dep, workspaceRange(dep, range, catalog, behind)])
        .sort(([a], [b]) => a.localeCompare(b)),
    );
  const manifest = {
    name,
    private: true,
    version,
    license: "MIT",
    ...rest,
    scripts: {
      ...keptScripts(scripts),
      "install-browsers": "playwright install chromium",
      generate: "conformance-fixture generate",
      "check-generate": "conformance-fixture check",
      conformance: "playwright test",
    },
    dependencies: mapped(dependencies),
    devDependencies: Object.fromEntries(
      Object.entries({
        ...mapped(devDependencies),
        "@playwright/test": "catalog:",
        "@zitadel/conformance": "workspace:*",
        "@zitadel/testing": "workspace:*",
      }).sort(([a], [b]) => a.localeCompare(b)),
    ),
    conformance: settings,
  };
  if (behind.length > 0) {
    // A catalog entry below what the generator writes would test the lane on
    // an older release than a customer can install: bump the catalog first.
    throw new Error(
      `the pnpm catalog is behind what setup writes; bump it in pnpm-workspace.yaml:\n${behind.join("\n")}`,
    );
  }
  return `${JSON.stringify(manifest, null, indent)}\n`;
}

/**
 * `workspace:*` for a Zitadel package, `catalog:` for one the catalog holds
 * at a floor the generated range accepts, and the generated range for one it
 * does not hold. A catalog entry whose floor the range rejects is recorded in
 * `behind`.
 */
function workspaceRange(dep, range, catalog, behind) {
  if (dep.startsWith("@zitadel/")) return "workspace:*";
  const pinned = catalog.get(dep);
  if (pinned === undefined) return range;
  const floor = semver.minVersion(pinned);
  if (!floor || !semver.satisfies(floor, range)) {
    behind.push(`  ${dep}: the catalog has ${pinned}, setup writes ${range}`);
  }
  return "catalog:";
}

/** The default catalog of pnpm-workspace.yaml: `name: range` lines under `catalog:`. */
async function readCatalog() {
  const lines = (await readFile(join(workspaceRoot, "pnpm-workspace.yaml"), "utf8")).split("\n");
  const catalog = new Map();
  const start = lines.indexOf("catalog:");
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    if (!line.startsWith(" ")) break;
    const entry = line.match(/^\s+(["']?)(.+?)\1:\s*(.+?)\s*$/);
    if (entry) catalog.set(entry[2], entry[3].replace(/^["']|["']$/g, ""));
  }
  return catalog;
}

/** Writes the generated files and deletes the ones setup no longer writes. */
async function write(fixtureDir, generated) {
  const changed = [];
  for (const path of await committedFiles(fixtureDir)) {
    if (!generated.has(path)) {
      await unlink(join(fixtureDir, path));
      changed.push(`deleted ${path}`);
    }
  }
  for (const [path, contents] of generated) {
    const current = await readFile(join(fixtureDir, path)).catch(() => undefined);
    if (current?.equals(contents)) continue;
    await mkdir(dirname(join(fixtureDir, path)), { recursive: true });
    await writeFile(join(fixtureDir, path), contents);
    changed.push(`${current ? "updated" : "created"} ${path}`);
  }
  console.log(changed.length > 0 ? changed.join("\n") : "fixture is up to date");
  if (changed.some((line) => line.endsWith(" package.json"))) {
    console.log("package.json changed: run `pnpm install` to update the lockfile");
  }
  // The generated .gitignore can ignore a file setup writes; the fixture
  // commits what setup writes all the same.
  const ignored = spawnSync("git", ["check-ignore", "--no-index", "--", ...generated.keys()], {
    cwd: fixtureDir,
    encoding: "utf8",
  }).stdout.trim();
  if (ignored !== "") {
    console.log(`git ignores files setup wrote; commit them with \`git add -f\`:\n${ignored}`);
  }
}

/** Fails, with a diff, when the committed fixture is not what setup writes. */
async function check(fixtureDir, work, generated, name) {
  const committed = new Set(await committedFiles(fixtureDir));
  const problems = [];
  for (const path of committed) {
    if (!generated.has(path)) problems.push(`${path}: in the fixture, but setup does not write it`);
  }
  const expectedDir = join(work, "expected");
  for (const [path, contents] of generated) {
    // Read from disk, not git's list: a file the generated .gitignore ignores
    // is still committed (`git add -f`).
    const current = await readFile(join(fixtureDir, path)).catch(() => undefined);
    if (!current) {
      problems.push(`${path}: setup writes it, but the fixture does not have it`);
      continue;
    }
    if (current.equals(contents)) continue;
    await mkdir(dirname(join(expectedDir, path)), { recursive: true });
    await writeFile(join(expectedDir, path), contents);
    const diff = spawnSync(
      "git",
      ["diff", "--no-index", "--no-color", "--", join(fixtureDir, path), join(expectedDir, path)],
      { encoding: "utf8" },
    );
    problems.push(`${path}: differs from what setup writes\n${diff.stdout}`);
  }
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    console.error(
      `\n${name} is out of date with the CLI's scaffolding. Regenerate it:\n  turbo run generate --filter=${name} && pnpm install`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`${name} matches what setup writes (${generated.size} files)`);
}

/** The fixture's files git tracks or would track, less the lane's own. */
async function committedFiles(fixtureDir) {
  const out = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z", "--", "."], {
    cwd: fixtureDir,
    encoding: "utf8",
  });
  return out
    .split("\0")
    .filter((path) => path !== "" && !HARNESS_FILES.has(path))
    .sort();
}

/** Every file under `root`, by its `/`-separated path, skipping the dropped directories. */
async function listFiles(root, dir = root) {
  const paths = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (dir === root && DROPPED_DIRS.includes(entry.name)) continue;
      paths.push(...(await listFiles(root, path)));
    } else if (entry.isFile()) {
      paths.push(relative(root, path).split(sep).join("/"));
    }
  }
  return paths.sort();
}

/** The caller's environment without any Zitadel setting that could steer setup. */
function setupEnv() {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^(ZITADEL_|NEXTGEN_)/.test(key)),
  );
  return { ...env, ZITADEL_TELEMETRY: "0", DO_NOT_TRACK: "1", NO_SKILLS_PROMPT: "1" };
}

function parseEnvelope(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return undefined;
  }
}

await main();
