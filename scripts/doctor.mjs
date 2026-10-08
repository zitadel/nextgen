#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runCapture } from "./dev-process.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const required = [];
const warnings = [];

await checkNode();
await checkPnpm();
checkNodeModules();
await checkGo();
await checkDocker();
await checkPlaywright();
await checkMoon();

printResults();
process.exit(required.length > 0 ? 1 : 0);

async function checkNode() {
  const expected = readText(".nvmrc").trim().replace(/^v/, "");
  const actual = process.versions.node;
  const expectedMajor = expected.split(".")[0];
  const actualMajor = actual.split(".")[0];
  if (actualMajor === expectedMajor) {
    pass(`Node ${actual} matches .nvmrc major ${expectedMajor}`);
    return;
  }
  fail(
    `Node ${actual} does not match .nvmrc (${expected})`,
    `Install/use Node ${expectedMajor}: nvm install ${expectedMajor} && nvm use ${expectedMajor}`,
  );
}

async function checkPnpm() {
  const manifest = JSON.parse(readText("package.json"));
  const expected = manifest.packageManager?.match(/^pnpm@([^+]+)/)?.[1];
  try {
    const { stdout } = await runCapture("corepack", ["pnpm", "--version"], {
      cwd: repoRoot,
    });
    const actual = stdout.trim();
    if (!expected || actual === expected) {
      pass(`pnpm ${actual}`);
      return;
    }
    fail(
      `pnpm ${actual} does not match packageManager (${expected})`,
      "Run: corepack enable && corepack pnpm install --frozen-lockfile",
    );
  } catch {
    fail("corepack/pnpm is not available", "Run: corepack enable");
  }
}

function checkNodeModules() {
  if (existsSync(join(repoRoot, "node_modules", ".bin", "moon"))) {
    pass("workspace dependencies are installed");
    return;
  }
  fail("workspace dependencies are not installed", "Run: corepack pnpm install --frozen-lockfile");
}

async function checkGo() {
  const expected = readText("go.mod").match(/^go\s+(\d+\.\d+)/m)?.[1];
  try {
    const { stdout } = await runCapture("go", ["version"], { cwd: repoRoot });
    const actual = stdout.match(/go(\d+\.\d+(?:\.\d+)?)/)?.[1] ?? stdout.trim();
    if (!expected || actual.startsWith(expected)) {
      pass(`Go ${actual}`);
      return;
    }
    fail(
      `Go ${actual} does not match go.mod (${expected})`,
      `Install Go ${expected} and make it first on PATH`,
    );
  } catch {
    fail("Go is not available", "Install the Go version from go.mod");
  }
}

async function checkDocker() {
  try {
    const { stdout } = await runCapture("docker", ["info", "--format", "{{.ServerVersion}}"], {
      cwd: repoRoot,
    });
    pass(`Docker engine ${stdout.trim()} is running`);
  } catch {
    fail(
      "Docker is not available; local runtime image builds need it",
      "Start Docker Desktop or another Docker daemon, then rerun doctor",
    );
  }
}

async function checkPlaywright() {
  const playwrightInfo = findPlaywrightBrowserInfo();
  if (!playwrightInfo) {
    warn(
      "Playwright package metadata is unavailable",
      "Run: corepack pnpm install --frozen-lockfile",
    );
    return;
  }

  const cacheRoot = resolvePlaywrightBrowserPath(playwrightInfo.packageRoot);
  const missing = playwrightInfo.browsers
    .filter((browser) => !existsSync(join(cacheRoot, browser.directory)))
    .map((browser) => browser.name);

  if (missing.length === 0) {
    pass("Playwright Chromium browsers are installed");
    return;
  }

  warn(
    `Playwright browsers missing: ${missing.join(", ")}`,
    "Run: corepack pnpm --filter @zitadel/cli-journey-e2e exec playwright install chromium",
  );
}

async function checkMoon() {
  // node_modules/.bin/moon is the authority: the catalog-pinned @moonrepo/cli
  // that pnpm scripts and CI resolve. A PATH lookup here could silently report
  // a global install instead.
  let pinned;
  try {
    const { stdout } = await runCapture(
      join(repoRoot, "node_modules", ".bin", "moon"),
      ["--version"],
      {
        cwd: repoRoot,
      },
    );
    pinned = stdout.trim();
    pass(`Moon ${pinned}`);
  } catch {
    fail(
      "Moon is not available; local checks and release tasks need it",
      "Run: corepack pnpm install --frozen-lockfile",
    );
    return;
  }

  try {
    const { stdout } = await runCapture("moon", ["--version"], {
      cwd: repoRoot,
    });
    const onPath = stdout.trim();
    if (onPath !== pinned) {
      warn(
        `moon on PATH is ${onPath} but the workspace pins ${pinned}`,
        "A global install shadows node_modules/.bin in plain shells; pnpm scripts and CI use the pinned one",
      );
    }
  } catch {
    // No moon on PATH at all is fine: pnpm scripts and CI resolve .bin anyway.
  }
}

function findPlaywrightBrowserInfo() {
  const pnpmDir = join(repoRoot, "node_modules", ".pnpm");
  if (!existsSync(pnpmDir)) {
    return null;
  }
  const playwrightCoreDir = readdirSync(pnpmDir).find((entry) =>
    entry.startsWith("playwright-core@"),
  );
  if (!playwrightCoreDir) {
    return null;
  }
  const browsersPath = join(
    pnpmDir,
    playwrightCoreDir,
    "node_modules",
    "playwright-core",
    "browsers.json",
  );
  if (!existsSync(browsersPath)) {
    return null;
  }
  const metadata = JSON.parse(readFileSync(browsersPath, "utf8"));
  return {
    packageRoot: join(pnpmDir, playwrightCoreDir, "node_modules", "playwright-core"),
    browsers: metadata.browsers
      .filter((browser) => ["chromium", "chromium-headless-shell"].includes(browser.name))
      .map((browser) => ({
        name: browser.name,
        directory:
          browser.name === "chromium-headless-shell"
            ? `chromium_headless_shell-${browser.revision}`
            : `chromium-${browser.revision}`,
      })),
  };
}

function resolvePlaywrightBrowserPath(packageRoot) {
  const envPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (envPath === "0") {
    return join(packageRoot, ".local-browsers");
  }
  if (envPath) {
    return resolve(process.env.INIT_CWD || process.cwd(), envPath);
  }
  return join(defaultCacheDirectory(), "ms-playwright");
}

function defaultCacheDirectory() {
  switch (process.platform) {
    case "linux":
      return process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
    case "darwin":
      return join(homedir(), "Library", "Caches");
    case "win32":
      return process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
    default:
      return join(homedir(), ".cache");
  }
}

function readText(relativePath) {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

function pass(message) {
  console.log(`ok  ${message}`);
}

function fail(message, fix) {
  required.push({ message, fix });
  console.error(`err ${message}`);
  console.error(`    fix: ${fix}`);
}

function warn(message, fix) {
  warnings.push({ message, fix });
  console.warn(`warn ${message}`);
  console.warn(`     fix: ${fix}`);
}

function printResults() {
  console.log("");
  if (required.length === 0 && warnings.length === 0) {
    console.log("Zitadel local development is ready.");
    return;
  }
  if (required.length > 0) {
    console.log(`Required fixes: ${required.length}`);
  }
  if (warnings.length > 0) {
    console.log(`Optional fixes for fuller workflows: ${warnings.length}`);
  }
}
