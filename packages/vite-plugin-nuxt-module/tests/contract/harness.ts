import { spawn } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { build } from "vite";

import nuxtModule from "vite-plugin-nuxt-module";

import { FIXTURES, PACKAGE_ROOT } from "./paths.ts";

export { FIXTURES, PACKAGE_ROOT };

/** The name the fixture module is published and installed under. */
export const MODULE_NAME = "hello-timing";

/** The bundled entries the fixture module adds next to `src/module.ts`. */
export const MODULE_ENTRIES = { server: "src/server.ts", shared: "src/shared.ts" } as const;

/** Where a run keeps its copies: inside the package, so they resolve its `node_modules`, and git-ignored. */
export function workDirectory(): string {
  return join(PACKAGE_ROOT, "test-output", "contract", String(process.pid));
}

/** Runs `command`, resolving with its output and rejecting with it when it exits non-zero. */
export function run(
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env?: NodeJS.ProcessEnv },
): Promise<string> {
  return new Promise((done, fail) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", fail);
    child.on("close", (code) =>
      code === 0
        ? done(output)
        : fail(new Error(`${command} ${args.join(" ")} exited with ${code}\n${output}`)),
    );
  });
}

/** `pnpm`, the way the run that started this one invoked it, else the one on the PATH. */
function pnpm(args: readonly string[]): [string, string[]] {
  const execPath = process.env.npm_execpath;
  return execPath && /pnpm/.test(execPath) && /\.[cm]?js$/.test(execPath)
    ? [process.execPath, [execPath, ...args]]
    : ["pnpm", [...args]];
}

/** A copy of the fixture `name` in `into`. */
export function copyFixture(name: "module" | "app", into: string): string {
  cpSync(join(FIXTURES, name), into, { recursive: true });
  return into;
}

/**
 * Builds the module at `moduleDir` with the plugin, as a project's own `vite build` would: the
 * plugin listed in its Vite config, with the module prepared first.
 */
export async function buildModule(moduleDir: string): Promise<void> {
  await build({
    root: moduleDir,
    configFile: false,
    logLevel: "warn",
    plugins: [nuxtModule({ entry: MODULE_ENTRIES, prepare: true })],
  });
}

/** `pnpm pack` of the package at `packageDir`, into `into`: the path of the tarball. */
export async function packModule(packageDir: string, into: string): Promise<string> {
  mkdirSync(into, { recursive: true });
  const [command, args] = pnpm(["pack", "--pack-destination", into]);
  await run(command, args, { cwd: packageDir });
  const [tarball] = readdirSync(into).filter((file) => file.endsWith(".tgz"));
  if (!tarball) throw new Error(`pnpm pack wrote no tarball into ${into}`);
  return join(into, tarball);
}

/** Extracts `tarball` as the package `name` of the app at `appDir`, like an install would. */
export async function installModule(
  tarball: string,
  appDir: string,
  name: string = MODULE_NAME,
): Promise<string> {
  const target = join(appDir, "node_modules", name);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  await run("tar", ["-xzf", tarball, "-C", target, "--strip-components=1"], { cwd: appDir });
  return target;
}

/** `nuxi prepare` in the app at `appDir`: writes `.nuxt/` with the types the installed module adds. */
export async function prepareApp(appDir: string): Promise<void> {
  const nuxi = join(PACKAGE_ROOT, "node_modules/.bin/nuxi");
  await run(nuxi, ["prepare"], { cwd: appDir, env: { NUXT_TELEMETRY_DISABLED: "1" } });
}

/**
 * The TypeScript errors of `file` in the prepared app at `appDir`, compiled the way Nuxt's
 * generated tsconfig compiles the app: its ambient declarations (the module's types among them)
 * and `file`, formatted as `tsc` prints them.
 */
export function typeErrors(appDir: string, file: string): string[] {
  const tsconfig = join(appDir, ".nuxt/tsconfig.json");
  const parsed = ts.getParsedCommandLineOfConfigFile(
    tsconfig,
    { noEmit: true },
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined },
  );
  if (!parsed) throw new Error(`cannot read ${tsconfig}`);
  const ambient = parsed.fileNames.filter((name) => /\.d\.[cm]?ts$/.test(name));
  const target = resolve(appDir, file);
  const program = ts.createProgram({
    rootNames: [...ambient, target],
    options: parsed.options,
  });
  const source = program.getSourceFile(target);
  if (!source) throw new Error(`${target} is not part of the program`);
  const host: ts.FormatDiagnosticsHost = {
    getCanonicalFileName: (name) => name,
    getCurrentDirectory: () => appDir,
    getNewLine: () => "\n",
  };
  return ts
    .getPreEmitDiagnostics(program, source)
    .map((diagnostic) => ts.formatDiagnostic(diagnostic, host).trimEnd());
}
