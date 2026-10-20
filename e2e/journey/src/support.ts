import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { expect, test, type Locator, type Page } from "@playwright/test";
import { sessionCookieName } from "@zitadel/testing/playwright";

import { frameworkForId } from "../scripts/frameworks.mjs";

/**
 * A variable the journey runner sets for the suites (JOURNEY_OUTPUT_DIR,
 * JOURNEY_APP_DIR, …), or a failure naming it when the suite runs without the
 * runner.
 */
export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export type JourneyMetadata = {
  appDir: string;
  cliPackage: string;
  framework: string;
  localRuntimeUrl: string | null;
  outputDir: string;
  preset: string | null;
  registryUrl: string;
  runtime: string;
};

/**
 * The journey's own metadata, plus the lanes a framework-independent suite
 * stays out of: the fresh next lane already covers `subject`, a preset lane
 * keeps to its sign-in journey, and the docker lane keeps to the scaffold
 * journey.
 */
export async function journeyMetadataOrSkip(
  subject: string,
): Promise<JourneyMetadata & { localRuntimeUrl: string }> {
  const metadata = JSON.parse(
    await readFile(join(requiredEnv("JOURNEY_OUTPUT_DIR"), "metadata.json"), "utf8"),
  ) as JourneyMetadata;
  test.skip(metadata.framework !== "next", `${subject} is framework-independent; next lane only`);
  test.skip(
    metadata.preset !== null,
    `the fresh-app lane already proves ${subject}; a preset lane keeps to its sign-in journey`,
  );
  test.skip(
    process.env.JOURNEY_PREEXISTING_APP === "1",
    `the fresh-app lane already proves ${subject}; keep the preexisting lane lean`,
  );
  test.skip(
    metadata.runtime === "docker",
    `the binary lane proves ${subject}; the docker lane keeps to the scaffold journey`,
  );
  if (!metadata.localRuntimeUrl) throw new Error("metadata.json has no localRuntimeUrl");
  return { ...metadata, localRuntimeUrl: metadata.localRuntimeUrl };
}

/**
 * Same npx invocation shape as prepare-app's steps (same registry and cache, so
 * the package resolves warm), returning the parsed `--json` envelope. `stdin`
 * is piped to the command, for a value a script supplies that way (a secret).
 */
export async function runCli(
  metadata: JourneyMetadata,
  args: string[],
  stdin?: string,
): Promise<unknown> {
  const run = promisify(execFile)(
    "npx",
    ["--yes", `${metadata.cliPackage}@alpha`, ...args, "--cwd", metadata.appDir],
    {
      cwd: metadata.appDir,
      env: {
        ...process.env,
        npm_config_audit: "false",
        npm_config_cache: join(metadata.outputDir, ".npm-cache"),
        npm_config_fund: "false",
        npm_config_registry: metadata.registryUrl,
        npm_config_yes: "true",
      },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  if (stdin !== undefined) run.child.stdin?.end(stdin);
  const { stdout } = await run;
  return JSON.parse(stdout) as unknown;
}

// Frameworks whose server SDK guards /profile (the registry's flag) must
// redirect a signed-out visit to /login; the SPA families have no server.
export const expectsProtectedRouteRedirect = frameworkForId(
  process.env.JOURNEY_FRAMEWORK ?? "next",
).expectsProtectedRouteRedirect;
export const loginUrl = /\/login(?:[/?#]|$)/;
const profileUrl = /\/profile(?:[/?#]|$)/;

export async function gotoLogin(page: Page): Promise<void> {
  if (loginUrl.test(page.url())) {
    return;
  }

  await page.waitForLoadState("load", { timeout: 5000 }).catch(() => undefined);
  if (loginUrl.test(page.url())) {
    return;
  }

  await page.goto("/login").catch(async (error: unknown) => {
    if (!isInterruptedByLoginNavigation(error) && !loginUrl.test(page.url())) {
      throw error;
    }
    if (!loginUrl.test(page.url())) {
      await page.waitForURL(loginUrl, { timeout: 5000 });
    }
  });
}

export async function expectSignedIn(page: Page): Promise<void> {
  await expect(page).toHaveURL(profileUrl, { timeout: 30_000 });
  await expect(signedInLocator(page).first()).toBeVisible({ timeout: 30_000 });
}

export async function logout(page: Page): Promise<void> {
  const logout = logoutLocator(page);
  const userMenu = page.getByRole("button", { name: /open user menu/i });

  // `<zitadel-session>` exposes Sign out directly; `<zitadel-logout>` hides it
  // behind an avatar menu. Wait for either surface, and only open the menu when
  // the direct logout control is not already visible.
  await Promise.race([
    logout.waitFor({ state: "visible", timeout: 30_000 }),
    userMenu.waitFor({ state: "visible", timeout: 30_000 }),
  ]);
  if (!(await logout.isVisible().catch(() => false))) {
    await userMenu.click();
    await logout.waitFor({ state: "visible", timeout: 5_000 });
  }
  await logout.click();
  const loggedOutUrl = expectsProtectedRouteRedirect ? loginUrl : /\/(?:login)?(?:[/?#]|$)/;
  await expect(page).toHaveURL(loggedOutUrl);
  await expectSessionCleared(page);
}

/**
 * The cookie the app keeps its session in: every scaffold's proxy, a server
 * SDK's or the dev proxy setup writes for an SPA, keeps it under the app's
 * project's name (ADR 073). setup records the project in `.zitadel/secret`.
 */
export async function appSessionCookieName(): Promise<string> {
  const secret = JSON.parse(
    await readFile(join(requiredEnv("JOURNEY_APP_DIR"), ".zitadel/secret"), "utf8"),
  ) as { project_id: string };
  return sessionCookieName(secret.project_id);
}

async function expectSessionCleared(page: Page): Promise<void> {
  const name = await appSessionCookieName();
  await expect
    .poll(async () => (await page.context().cookies()).some((cookie) => cookie.name === name), {
      timeout: 5000,
    })
    .toBe(false);
}

function isInterruptedByLoginNavigation(error: unknown): boolean {
  return error instanceof Error && isExpectedNavigationRace(error.message, "/login");
}

function isExpectedNavigationRace(message: string, path: string): boolean {
  return (
    (message.includes('interrupted by another navigation to "') ||
      message.includes("net::ERR_ABORTED at ")) &&
    message.includes(path)
  );
}

function profileActionLocator(page: Page): Locator {
  return logoutLocator(page).or(page.getByRole("button", { name: /open user menu/i }));
}

function signedInLocator(page: Page): Locator {
  return page.getByRole("heading", { name: /signed in/i }).or(profileActionLocator(page));
}

function logoutLocator(page: Page) {
  return page
    .locator("zitadel-logout .signout-btn")
    .or(page.locator('zl-button[action="logout"], [data-action="logout"]'))
    .or(page.getByRole("button", { name: /logout|sign out/i }))
    .or(page.getByRole("link", { name: /logout|sign out/i }));
}
