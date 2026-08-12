import { existsSync } from "node:fs";
import { extname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { PlaywrightTestConfig } from "@playwright/test";

import type { AppEnvTemplate } from "./app-env";
import {
  APP_RUNNER_CONFIG_ENV,
  HANDSHAKE_ENV,
  SUPERVISOR_CONFIG_ENV,
  type AppRunnerConfig,
  type SupervisorConfig,
} from "./orchestration";

type WebServerEntry = Extract<
  NonNullable<PlaywrightTestConfig["webServer"]>,
  readonly unknown[]
>[number];

export interface WithZitadelOptions {
  /**
   * The Playwright config's directory (`import.meta.dirname`). Anchors the
   * default handshake location and the working directory of the generated
   * webServer entries.
   */
  configDir: string;
  /**
   * Fixed TCP port for the instance. Required (unlike `startLocalZitadel`,
   * which defaults to a free port) because Playwright's readiness URL must be
   * known while the config is evaluated, before anything boots.
   */
  port: number;
  /**
   * Origin the browser will use for the app under test. Registered as the
   * project's preview origin (the backend's origin check rejects forwarded
   * requests from unregistered origins) and the base of `app.readyPath`.
   */
  appOrigin: string;
  /** Boot/bootstrap options forwarded to the instance supervisor. */
  zitadel?: {
    /** Absolute path to the server binary. */
    serverBinary?: string;
    /** Appended to the missing-binary error, e.g. "run `moon run server:build` first." */
    serverBinaryHint?: string;
    projectName?: string;
    preset?: SupervisorConfig["preset"];
    useCase?: SupervisorConfig["useCase"];
    /** Absolute state directory; defaults to a fresh temp dir removed on stop. */
    dir?: string;
    /** Keep the owned temp dir after stop (debugging). */
    keep?: boolean;
    /** webServer readiness timeout for the boot; cold boot dominates it. */
    bootTimeoutMs?: number;
  };
  /**
   * The app dev server to run against the instance.
   *
   * Omit it when the **instance itself serves the app** — the Zitadel binary
   * embeds the console and hosted login shells at `/ui/console/` and
   * `/ui/login/`, so there is no second server to boot and no env to hand it.
   * Only the supervisor entry is generated, and `appOrigin` must then be the
   * instance's own origin (a suite testing the embedded surfaces has no other
   * origin to visit). This is the only configuration that exercises the
   * production path — under a dev server, the app's proxy rewrites API
   * requests that the binary would serve directly.
   */
  app?: {
    /** Spawn argv (no shell), e.g. ["corepack", "pnpm", "--filter", "my-app", "dev"]. */
    command: string[];
    /** Working directory for the app command. */
    cwd: string;
    /** Path on `appOrigin` Playwright polls for readiness, e.g. "/login". */
    readyPath: string;
    /**
     * Env vars the app needs, as a template mapping env names to
     * InstanceHandle fields — see `nextAppEnv` for the `@zitadel/sdk-next`
     * shape. A template (not a callback) because it crosses into the app
     * runner process.
     */
    env: AppEnvTemplate;
    readyTimeoutMs?: number;
    /** How long SIGTERM gets before the app is killed on teardown. */
    gracefulShutdownMs?: number;
  };
  /** Absolute path; defaults to `<configDir>/.zitadel-testing/handshake.json`. */
  handshakePath?: string;
}

/**
 * Generate the Playwright `webServer` entries that boot an ephemeral seeded
 * Zitadel and run the app against it, replacing the per-suite wrapper
 * scripts. Spread the result into `defineConfig`:
 *
 * ```ts
 * export default defineConfig({
 *   ...withZitadel({ configDir: import.meta.dirname, port: 8092, ... }),
 *   testDir: "./src-real",
 * });
 * ```
 *
 * Omit `app` when the instance serves the app itself (the binary's embedded
 * `/ui/console/` and `/ui/login/` surfaces): only the boot entry is
 * generated, and `appOrigin` must be the instance's own origin.
 *
 * Also points ZITADEL_TESTING_HANDSHAKE at the handshake file so the
 * `@zitadel/testing/playwright` fixtures resolve the instance — Playwright
 * workers re-evaluate the config, which re-applies this for every process
 * that needs it. The returned value is plain data; append your own entries
 * to `webServer` if the suite needs additional servers.
 */
export function withZitadel(
  options: WithZitadelOptions,
  /** Test seam: alternative executable resolution. */
  resolveEntry: (name: "supervisor" | "app-runner") => string = entryPoint,
): { webServer: WebServerEntry[] } {
  const { configDir, port, appOrigin, app } = options;
  if (!isAbsolute(configDir)) {
    throw new Error(`withZitadel: configDir must be absolute, got "${configDir}"`);
  }
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`withZitadel: port must be a positive integer, got ${port}`);
  }
  const origin = URL.canParse(appOrigin) ? new URL(appOrigin) : undefined;
  if (
    !origin ||
    (origin.protocol !== "http:" && origin.protocol !== "https:") ||
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== ""
  ) {
    throw new Error(
      `withZitadel: appOrigin must be an origin like "http://localhost:3002", got "${appOrigin}"`,
    );
  }
  if (app === undefined) {
    // Nothing else will bind appOrigin, so a mismatched port means the suite
    // would poll an origin no one serves — Playwright's readiness wait would
    // pass against a stale server or hang until timeout. Hostname is free
    // (localhost / 127.0.0.1 both reach the instance); the port is the claim.
    const originPort = origin.port || (origin.protocol === "https:" ? "443" : "80");
    if (originPort !== String(port)) {
      throw new Error(
        `withZitadel: with no \`app\`, the instance serves the app itself, so appOrigin ` +
          `must point at the instance's own port (${port}); got "${appOrigin}".`,
      );
    }
  } else {
    if (!app.readyPath.startsWith("/")) {
      throw new Error(`withZitadel: app.readyPath must start with "/", got "${app.readyPath}"`);
    }
    if (app.command.length === 0) {
      throw new Error("withZitadel: app.command must not be empty");
    }
    if (!isAbsolute(app.cwd)) {
      throw new Error(`withZitadel: app.cwd must be absolute, got "${app.cwd}"`);
    }
  }
  // Path options are consumed by the executables, whose cwd is configDir —
  // a relative path would silently resolve against that, not the project.
  for (const [label, value] of [
    ["zitadel.serverBinary", options.zitadel?.serverBinary],
    ["zitadel.dir", options.zitadel?.dir],
    ["handshakePath", options.handshakePath],
  ] as const) {
    if (value !== undefined && !isAbsolute(value)) {
      throw new Error(`withZitadel: ${label} must be an absolute path, got "${value}"`);
    }
  }

  const handshakePath =
    options.handshakePath ?? join(configDir, ".zitadel-testing", "handshake.json");
  // Workers inherit the runner's env; the fixtures resolve the instance from it.
  process.env[HANDSHAKE_ENV] = handshakePath;

  const supervisorConfig: SupervisorConfig = {
    port,
    appOrigins: [appOrigin],
    serverBinary: options.zitadel?.serverBinary,
    serverBinaryHint: options.zitadel?.serverBinaryHint,
    dir: options.zitadel?.dir,
    keep: options.zitadel?.keep,
    projectName: options.zitadel?.projectName,
    preset: options.zitadel?.preset,
    useCase: options.zitadel?.useCase,
  };
  const supervisorEntry: WebServerEntry = {
    command: `node ${JSON.stringify(resolveEntry("supervisor"))}`,
    url: `http://localhost:${port}/healthz`,
    reuseExistingServer: false,
    cwd: configDir,
    stdout: "pipe",
    stderr: "pipe",
    // Cold boot (fresh data dir: migrations + health wait) dominates.
    timeout: options.zitadel?.bootTimeoutMs ?? 120_000,
    env: {
      [HANDSHAKE_ENV]: handshakePath,
      [SUPERVISOR_CONFIG_ENV]: JSON.stringify(supervisorConfig),
    },
    // SIGTERM first so the supervisor can stop the instance; the default
    // hard kill would orphan the server process group.
    gracefulShutdown: { signal: "SIGTERM", timeout: 30_000 },
  };

  if (app === undefined) {
    return { webServer: [supervisorEntry] };
  }

  const appRunnerConfig: AppRunnerConfig = {
    command: app.command,
    cwd: app.cwd,
    env: app.env,
    handshakeTimeoutMs: app.readyTimeoutMs ?? 180_000,
  };

  return {
    webServer: [
      supervisorEntry,
      {
        command: `node ${JSON.stringify(resolveEntry("app-runner"))}`,
        url: new URL(app.readyPath, appOrigin).toString(),
        reuseExistingServer: false,
        cwd: configDir,
        stdout: "pipe",
        stderr: "pipe",
        timeout: app.readyTimeoutMs ?? 180_000,
        env: {
          [HANDSHAKE_ENV]: handshakePath,
          [APP_RUNNER_CONFIG_ENV]: JSON.stringify(appRunnerConfig),
        },
        gracefulShutdown: {
          signal: "SIGTERM",
          timeout: app.gracefulShutdownMs ?? 15_000,
        },
      },
    ],
  };
}

/**
 * Resolve a sibling dist entry in the same module format this file was loaded
 * as (dist/supervisor.mjs next to dist/playwright.mjs, .cjs next to .cjs), so
 * the spawned process needs no package-manager bin plumbing.
 */
function entryPoint(name: "supervisor" | "app-runner"): string {
  const self = fileURLToPath(import.meta.url);
  const ext = extname(self);
  if (ext !== ".mjs" && ext !== ".cjs") {
    throw new Error(
      `withZitadel: expected to run from the built package (got ${self}); ` +
        "build @zitadel/testing first (in-repo: `moon run testing:build`).",
    );
  }
  const path = fileURLToPath(new URL(`./${name}${ext}`, import.meta.url));
  if (!existsSync(path)) {
    throw new Error(
      `withZitadel: missing ${path}; rebuild @zitadel/testing (in-repo: \`moon run testing:build\`).`,
    );
  }
  return path;
}
