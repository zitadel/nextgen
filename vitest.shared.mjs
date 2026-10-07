import { existsSync, mkdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Shared Vitest `test` defaults, spread into every project's own config:
 *
 *   import { defineConfig } from "vitest/config";
 *   import { baseTest } from "../../vitest.shared.mjs";
 *   export default defineConfig({
 *     test: { ...baseTest, name: "@zitadel/x", environment: "node" },
 *   });
 *
 * It is a plain object (not `defineConfig`/`mergeConfig`) on purpose: every
 * project resolves Vitest 4 from the root catalog, but a plain object of the
 * shared `test` fields stays trivially assignable and keeps this base decoupled
 * from any one Vitest version's config type. It ships as `.mjs` + a hand-written
 * `.d.mts` so it resolves under both `bundler` and `nodenext` TypeScript
 * projects (including composite ones) without being pulled into each project's
 * compiled file list.
 *
 * Only genuinely shared fields live here. Per-project axes — `environment`,
 * `plugins`, `resolve.conditions`, `include`, `setupFiles`/`globalSetup`, the
 * unit+browser `projects` split — stay in each project's config.
 *
 * @type {import("./vitest.shared.d.mts").BaseTest}
 */
export const baseTest = {
  watch: false,
  globals: true,
  // Run test files in parallel via the worker pool (Vitest's default, pinned
  // here so no project can silently regress to serial execution). Files within
  // a project run concurrently; moon runs the projects concurrently on top.
  fileParallelism: true,
  // Fail loud when a suite's include matches nothing (a broken glob or all tests
  // removed), restoring the pre-migration behavior. A genuinely test-less lane
  // (login-ui) overrides this to `true` in its own config.
  passWithNoTests: false,
  // Discover both suffixes under src/, so a package can't silently drop a whole
  // suite by matching only one of *.spec / *.test. Packages whose tests live
  // outside src/ (cli → tests/, workspace/cli-journey-e2e → scripts/) or that
  // split into sub-projects override `include` in their own config.
  include: ["src/**/*.{test,spec}.{ts,tsx}"],
  // No shared globalSetup: the only setup work is package-specific (config syncs
  // its meta-schemas; cli builds its dist via a moon dep). Forcing it here would
  // couple every project's tests to another package's inputs. A package that
  // needs setup declares its own `globalSetup` at its package root.
  // Console output plus a machine-readable result report at a uniform path.
  // The path lives in `outputFile` (Vitest's canonical location) rather than the
  // reporter tuple, so a lane that runs concurrently in the same package cwd
  // (e.g. `test:browser`) can override just this via `--outputFile.junit=…`.
  reporters: ["default", "junit"],
  outputFile: { junit: "./test-output/vitest/junit.xml" },
  coverage: {
    provider: "v8",
    reportsDirectory: "./test-output/vitest/coverage",
    // Every source extension in use across the workspace (.ts/.tsx/.svelte),
    // plus .vue defensively for the Vue SDK. Keep in sync with a
    // `find */src -type f` extension sweep when adding a new framework.
    include: ["src/**/*.{ts,tsx,vue,svelte}"],
  },
};

/**
 * Resolve sibling `@zitadel/*` workspace packages to their TypeScript source
 * (matching the repo tsconfig's custom condition), so tests exercise shipped
 * code. Spread into `resolve.conditions` for workspace-source consumers.
 */
export const sourceConditions = ["@zitadel/source"];

// ---------------------------------------------------------------------------
// SPIKE (#1499): share ONE real Chromium across the separate browser-mode
// `vitest` processes instead of each one launching its own. Every browser suite
// is its own moon task = its own `vitest` process; with four of them each
// booting a Chromium, a busy CI runner starves them and drops module fetches
// ("Failed to fetch dynamically imported module"). Here the first process to
// start launches a Playwright browser SERVER and records its wsEndpoint in a
// tmp lockfile; the rest CONNECT to it. A refcount keeps the shared browser
// alive until the last process releases it; the owner (launcher) waits for the
// count to drain, then closes it. Logs loudly so CI shows one LAUNCH and N
// REUSE on the same endpoint. The config passes in its own `playwright` factory
// and `chromium` (pnpm: this root file can't resolve them, the package can).
// ---------------------------------------------------------------------------
const SB_DIR = join(tmpdir(), "zitadel-vitest-shared-chromium");
const SB_LOCK = `${SB_DIR}.lock`;
const SB_REG = join(SB_DIR, "registry.json");
let sbOwnedServer = null;
const sbLog = (m) => console.log(`[shared-chromium pid=${process.pid}] ${m}`);

async function sbWithLock(fn) {
  mkdirSync(SB_DIR, { recursive: true });
  for (let i = 0; i < 4000; i += 1) {
    try {
      mkdirSync(SB_LOCK);
    } catch {
      await new Promise((r) => setTimeout(r, 5));
      continue;
    }
    try {
      return await fn();
    } finally {
      try {
        rmdirSync(SB_LOCK);
      } catch {}
    }
  }
  throw new Error("[shared-chromium] lock timeout");
}

const sbReadReg = () => (existsSync(SB_REG) ? JSON.parse(readFileSync(SB_REG, "utf8")) : null);
const sbWriteReg = (r) => writeFileSync(SB_REG, JSON.stringify(r));

async function sbAcquire(chromium) {
  return sbWithLock(async () => {
    const reg = sbReadReg();
    if (reg?.wsEndpoint) {
      try {
        const probe = await chromium.connect(reg.wsEndpoint, { timeout: 5000 });
        await probe.close();
        reg.refs += 1;
        sbWriteReg(reg);
        sbLog(`REUSE shared browser  ws=…${reg.wsEndpoint.slice(-18)}  refcount=${reg.refs}`);
        return { wsEndpoint: reg.wsEndpoint, owner: false };
      } catch {
        sbLog("registry endpoint is stale, relaunching");
      }
    }
    const server = await chromium.launchServer({ headless: true });
    sbOwnedServer = server;
    const wsEndpoint = server.wsEndpoint();
    sbWriteReg({ wsEndpoint, refs: 1, ownerPid: process.pid, chromePid: server.process()?.pid });
    sbLog(`LAUNCH shared browser  chromePid=${server.process()?.pid}  ws=…${wsEndpoint.slice(-18)}  refcount=1`);
    return { wsEndpoint, owner: true };
  });
}

async function sbRelease(owner) {
  await sbWithLock(async () => {
    const reg = sbReadReg();
    if (!reg) return;
    reg.refs = Math.max(0, reg.refs - 1);
    sbWriteReg(reg);
    sbLog(`release  refcount=${reg.refs}`);
  });
  if (owner && sbOwnedServer) {
    for (let i = 0; i < 600; i += 1) {
      const reg = sbReadReg();
      if (!reg || reg.refs <= 0) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    sbLog("owner closing the shared browser");
    await sbOwnedServer.close().catch(() => {});
    sbOwnedServer = null;
    try {
      unlinkSync(SB_REG);
    } catch {}
  }
}

/**
 * Wrap `@vitest/browser-playwright`'s `playwright()` provider so the four
 * browser suites share one Chromium. Pass the package's own `playwright`
 * factory and `chromium` (from `playwright`): `provider: sharedChromium({ playwright, chromium })`.
 *
 * @param {{ playwright: Function, chromium: any, options?: object }} deps
 */
export function sharedChromium({ playwright, chromium, options = {} }) {
  const descriptor = playwright(options);
  const originalFactory = descriptor.providerFactory;
  descriptor.providerFactory = (project) => {
    const provider = originalFactory(project);
    const originalOpen = provider.openBrowser.bind(provider);
    const originalClose = provider.close.bind(provider);
    let owner = false;
    provider.openBrowser = async (...args) => {
      if (!provider.options.connectOptions?.wsEndpoint) {
        const got = await sbAcquire(chromium);
        owner = got.owner;
        provider.options.connectOptions = {
          ...(provider.options.connectOptions || {}),
          wsEndpoint: got.wsEndpoint,
        };
      }
      return originalOpen(...args);
    };
    provider.close = async () => {
      await originalClose().catch((e) => sbLog(`close error: ${e.message}`));
      await sbRelease(owner);
    };
    return provider;
  };
  return descriptor;
}
