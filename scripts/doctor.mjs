#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { join } from "node:path";

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
await checkGoReleaser();

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
  if (existsSync(join(repoRoot, "node_modules", ".bin", "nx"))) {
    pass("workspace dependencies are installed");
    return;
  }
  fail(
    "workspace dependencies are not installed",
    "Run: corepack pnpm install --frozen-lockfile",
  );
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
    warn(
      "Docker is not available; journey and integration checks need it",
      "Start Docker Desktop or another Docker daemon, then rerun doctor",
    );
  }
}

async function checkPlaywright() {
  const browserInfo = findPlaywrightBrowserInfo();
  if (!browserInfo) {
    warn(
      "Playwright package metadata is unavailable",
      "Run: corepack pnpm install --frozen-lockfile",
    );
    return;
  }

  const cacheRoot = join(homedir(), ".cache", "ms-playwright");
  const missing = browserInfo
    .filter((browser) => !existsSync(join(cacheRoot, browser.directory)))
    .map((browser) => browser.name);

  if (missing.length === 0) {
    pass("Playwright Chromium browsers are installed");
    return;
  }

  warn(
    `Playwright browsers missing: ${missing.join(", ")}`,
    "Run: corepack pnpm --filter @zitadel/demo-next-e2e exec playwright install chromium",
  );
}

async function checkGoReleaser() {
  try {
    const { stdout, stderr } = await runCapture("goreleaser", ["--version"], {
      cwd: repoRoot,
    });
    const versionLine = `${stdout}${stderr}`
      .split(/\r?\n/)
      .find((line) => line.startsWith("GitVersion:"));
    const version = versionLine?.split(/\s+/).at(1) ?? "available";
    pass(`GoReleaser ${version}`);
  } catch {
    warn(
      "GoReleaser is not available; release checks need it",
      "Install GoReleaser v2: https://goreleaser.com/install/",
    );
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
  return metadata.browsers
    .filter((browser) => ["chromium", "chromium-headless-shell"].includes(browser.name))
    .map((browser) => ({
      name: browser.name,
      directory:
        browser.name === "chromium-headless-shell"
          ? `chromium_headless_shell-${browser.revision}`
          : `chromium-${browser.revision}`,
    }));
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
