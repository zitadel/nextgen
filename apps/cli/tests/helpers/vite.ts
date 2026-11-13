import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  createServer,
  type InlineConfig,
  type ProxyOptions,
  type ResolvedConfig,
  resolveConfig,
} from "vite";

/** The dev server of a generated app, running in this process. */
export interface DevApp {
  /** Where the browser opens the app: `http://localhost:<port>`. */
  readonly origin: string;
  /** Stops the dev server and removes its app directory. */
  close(): Promise<void>;
}

/**
 * What stands in for `.env.local`. The generated proxies load it from the
 * working directory, which a test does not own, so the values are set in the
 * environment instead, and only while the proxy is being built.
 */
export type AppEnv = Readonly<Record<string, string>>;

const requireHere = createRequire(import.meta.url);
const viteDir = dirname(requireHere.resolve("vite/package.json"));

/**
 * Serves a generated `vite.config` the way `npm run dev` does: from an app
 * directory of its own, with `vite` resolving to the workspace's copy.
 */
export async function aViteApp(config: string, env: AppEnv): Promise<DevApp> {
  const dir = await mkdtemp(join(tmpdir(), "zitadel-vite-"));
  await mkdir(join(dir, "node_modules"));
  await symlink(viteDir, join(dir, "node_modules", "vite"), "dir");
  await writeFile(join(dir, "vite.config.mjs"), config);
  return serve(dir, env, () => ({ configFile: join(dir, "vite.config.mjs") }));
}

/**
 * Loads a generated `vite.config` the way `vite build` does, from an app
 * directory of its own, and removes the directory again.
 */
export async function aViteBuildConfig(config: string, env: AppEnv): Promise<ResolvedConfig> {
  const dir = await mkdtemp(join(tmpdir(), "zitadel-vite-"));
  await mkdir(join(dir, "node_modules"));
  await symlink(viteDir, join(dir, "node_modules", "vite"), "dir");
  await writeFile(join(dir, "vite.config.mjs"), config);
  const previous = Object.fromEntries(Object.keys(env).map((name) => [name, process.env[name]]));
  Object.assign(process.env, env);
  try {
    return await resolveConfig(
      { configFile: join(dir, "vite.config.mjs"), root: dir, logLevel: "silent" },
      "build",
    );
  } finally {
    restore(previous);
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Serves a generated `proxy.conf.cjs` on Vite's dev server, which `ng serve`
 * builds on when `angular.json` points its `proxyConfig` at the file.
 */
export async function aProxyConfApp(proxyConf: string, env: AppEnv): Promise<DevApp> {
  const dir = await mkdtemp(join(tmpdir(), "zitadel-ng-"));
  await writeFile(join(dir, "proxy.conf.cjs"), proxyConf);
  return serve(dir, env, () => ({
    configFile: false,
    server: { proxy: requireHere(join(dir, "proxy.conf.cjs")) as Record<string, ProxyOptions> },
  }));
}

async function serve(dir: string, env: AppEnv, config: () => InlineConfig): Promise<DevApp> {
  const previous = Object.fromEntries(Object.keys(env).map((name) => [name, process.env[name]]));
  Object.assign(process.env, env);
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
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") {
      await server.close();
      throw new Error("the Vite dev server did not listen on a TCP port");
    }
    return {
      origin: `http://localhost:${address.port}`,
      async close() {
        await server.close();
        await rm(dir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  } finally {
    restore(previous);
  }
}

/** Puts back the environment variables a run set, as they were before it. */
function restore(previous: Readonly<Record<string, string | undefined>>): void {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}
