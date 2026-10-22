import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { realPackageDirectory, resolveFromRoot } from "./resolve.ts";

/** The Nuxt packages `nuxi` comes with, in the order they are looked for. */
export const NUXT_PACKAGES: readonly string[] = ["nuxt-nightly", "nuxt", "nuxt3", "nuxt-edge"];

/** The Nuxt config `nuxt-module-build prepare` prepares a module with (the module itself is added on top). */
export const PREPARE_OVERRIDES = {
  compatibilityDate: "2024-04-03",
  typescript: { builder: "shared" },
  imports: { autoImport: false },
} as const;

/** `@nuxt/cli` (`nuxi`): the copy the installed Nuxt comes with, else the module's own. */
export function resolveNuxtCli(root: string): string | undefined {
  for (const name of NUXT_PACKAGES) {
    const nuxt = realPackageDirectory(name, root);
    const cli = nuxt && resolveFromRoot("@nuxt/cli", nuxt);
    if (cli) return cli;
  }
  return resolveFromRoot("@nuxt/cli", root);
}

/**
 * Runs in a child process: `nuxi prepare` through `@nuxt/cli`'s `runCommand`, with what
 * `nuxt-module-build prepare` hands it: its overrides, the module, and a hook that writes every app
 * template, so the module's playground types (`.nuxt/tsconfig.json`, `#app`, `#imports`,
 * `#build/*`) exist before the module is built. The hook is a function: it is written here, not
 * passed in.
 */
const PREPARE_SCRIPT = `
const o = JSON.parse(process.env.NUXT_MODULE_PREPARE);
const { runCommand } = await import(o.cli);
await runCommand("prepare", [o.root], {
  overrides: {
    ...o.overrides,
    modules: [
      o.module,
      (_options, nuxt) => {
        nuxt.hooks.hook("app:templates", (app) => {
          for (const template of app.templates) template.write = true;
        });
      },
    ],
  },
});
process.exit(0);
`;

/**
 * `nuxt-module-build prepare` for the module at `root`: `nuxi prepare` in `root` with the module
 * (`moduleEntry`, its source file) installed, which writes its types into the build directory
 * (`.nuxt`) the module's tsconfig extends. Runs in a child process so Nuxt's globals and open
 * handles never reach the build.
 */
export async function prepareModule(root: string, moduleEntry: string): Promise<void> {
  const cli = resolveNuxtCli(root);
  if (!cli)
    throw new Error(`nuxtModule: prepare needs \`nuxt\` (or \`@nuxt/cli\`) installed in ${root}`);
  const options = {
    cli: pathToFileURL(cli).href,
    root,
    module: resolve(root, moduleEntry),
    overrides: PREPARE_OVERRIDES,
  };
  const { code, out } = await new Promise<{ code: number; out: string }>((done) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", PREPARE_SCRIPT], {
      cwd: root,
      env: { ...process.env, NUXT_MODULE_PREPARE: JSON.stringify(options) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let text = "";
    child.stdout.on("data", (d) => {
      text += d;
    });
    child.stderr.on("data", (d) => {
      text += d;
    });
    child.on("close", (exit) => done({ code: exit ?? 1, out: text }));
  });
  if (code !== 0) throw new Error(`nuxtModule: preparing ${root} failed\n${out}`);
}
