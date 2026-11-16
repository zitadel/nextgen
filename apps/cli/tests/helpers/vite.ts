import { mkdir, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { onTestFinished, vi } from "vitest";
import {
  createServer,
  type InlineConfig,
  preview,
  type ProxyOptions,
  type ResolvedConfig,
  resolveConfig,
} from "vite";

import { scratchDir } from "./scratch";

/** The dev server of a generated app, running in this process. */
export interface DevApp {
  /** Where the browser opens the app: `http://localhost:<port>`. */
  readonly origin: string;
  /**
   * Stops the dev server. The test's end does the same, and removes the app
   * directory, so a test that needs the server gone sooner is the only one to call it.
   */
  close(): Promise<void>;
}

/**
 * What stands in for `.env.local`: values set in the environment, and only
 * while the proxy is being built.
 */
export type AppEnv = Readonly<Record<string, string>>;

/**
 * Files written into the app directory, such as `.env.local`. The generated
 * proxies load env files from the working directory, so the directory is the
 * working directory while the proxy is being built.
 */
export type AppFiles = Readonly<Record<string, string>>;

const requireHere = createRequire(import.meta.url);
const viteDir = dirname(requireHere.resolve("vite/package.json"));

/**
 * Serves a generated `vite.config` the way `npm run dev` does: from an app
 * directory of its own, with `vite` resolving to the workspace's copy.
 */
export async function aViteApp(config: string, env: AppEnv, files: AppFiles = {}): Promise<DevApp> {
  const dir = await anAppDir(config, files);
  return serve(dir, env, () => ({ configFile: join(dir, "vite.config.mjs") }));
}

/**
 * Serves a generated `vite.config` the way `vite preview` does, over an
 * empty build, from an app directory of its own.
 */
export async function aVitePreview(config: string, env: AppEnv): Promise<DevApp> {
  const dir = await anAppDir(config, { "dist/index.html": "<!doctype html>\n" });
  const previous = applied(env);
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    const server = await preview({
      configFile: join(dir, "vite.config.mjs"),
      root: dir,
      logLevel: "silent",
      preview: { port: 0 },
    });
    onTestFinished(() => {
      return server.close();
    });
    const address = server.httpServer.address();
    if (!address || typeof address === "string") {
      throw new Error("the Vite preview server did not listen on a TCP port");
    }
    return {
      origin: `http://localhost:${address.port}`,
      async close() {
        await server.close();
      },
    };
  } finally {
    process.chdir(cwd);
    restore(previous);
  }
}

/** An app directory holding `config` as `vite.config.mjs`, `files`, and `vite` resolving to the workspace's copy. */
async function anAppDir(config: string, files: AppFiles): Promise<string> {
  const dir = await scratchDir("zitadel-vite-");
  await mkdir(join(dir, "node_modules"));
  await symlink(viteDir, join(dir, "node_modules", "vite"), "dir");
  await writeFile(join(dir, "vite.config.mjs"), config);
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), contents);
  }
  return dir;
}

/**
 * Sets `env` in the process environment for the test, returning what it replaced.
 *
 * @param env - The variables to set.
 * @returns The values the variables had, to put back with {@link restore}.
 */
function applied(env: AppEnv): Record<string, string | undefined> {
  const previous = Object.fromEntries(Object.keys(env).map((name) => [name, process.env[name]]));
  for (const [name, value] of Object.entries(env)) {
    vi.stubEnv(name, value);
  }
  return previous;
}

/**
 * Loads a generated `vite.config` the way `vite build` does, from an app
 * directory of its own, which is removed when the test ends.
 */
export async function aViteBuildConfig(config: string, env: AppEnv): Promise<ResolvedConfig> {
  const dir = await anAppDir(config, {});
  const previous = applied(env);
  try {
    return await resolveConfig(
      { configFile: join(dir, "vite.config.mjs"), root: dir, logLevel: "silent" },
      "build",
    );
  } finally {
    restore(previous);
  }
}

/**
 * Serves a generated `proxy.conf.cjs` on Vite's dev server, which `ng serve`
 * builds on when `angular.json` points its `proxyConfig` at the file.
 */
export async function aProxyConfApp(proxyConf: string, env: AppEnv): Promise<DevApp> {
  const dir = await scratchDir("zitadel-ng-");
  await writeFile(join(dir, "proxy.conf.cjs"), proxyConf);
  return serve(dir, env, () => ({
    configFile: false,
    server: { proxy: requireHere(join(dir, "proxy.conf.cjs")) as Record<string, ProxyOptions> },
  }));
}

/**
 * Starts Vite's dev server on a port the OS picks, in `dir`, with `env` set while it is built. The
 * server is stopped when the test ends.
 *
 * @param dir - The app directory, which is also the working directory while the server is built.
 * @param env - The variables to set while the server is built.
 * @param config - The Vite configuration to serve.
 * @returns The running app.
 * @throws Error when the server does not listen on a TCP port.
 */
async function serve(dir: string, env: AppEnv, config: () => InlineConfig): Promise<DevApp> {
  const previous = applied(env);
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    const inline = config();
    const server = await createServer({
      ...inline,
      root: dir,
      logLevel: "silent",
      clearScreen: false,
      // The OS picks the port: the config's own strictPort pin would collide
      // across test files running in parallel.
      server: { ...inline.server, port: 0, watch: null },
    });
    onTestFinished(() => {
      return server.close();
    });
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") {
      throw new Error("the Vite dev server did not listen on a TCP port");
    }
    return {
      origin: `http://localhost:${address.port}`,
      async close() {
        await server.close();
      },
    };
  } finally {
    process.chdir(cwd);
    restore(previous);
  }
}

/**
 * Puts back the environment variables a run set, as they were before it.
 *
 * @param previous - What {@link applied} returned.
 */
function restore(previous: Readonly<Record<string, string | undefined>>): void {
  for (const [name, value] of Object.entries(previous)) {
    vi.stubEnv(name, value);
  }
}
