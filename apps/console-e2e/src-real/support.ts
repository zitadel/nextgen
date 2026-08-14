import type { Page } from "@playwright/test";
import { expect } from "@zitadel/testing/playwright";

/**
 * Shared helpers for the real-instance console suites.
 *
 * `signIn` had been copied verbatim into all three spec files. It is the one
 * step every real-instance test starts with, so a drift between copies would
 * mean the suites were signing in differently while looking identical.
 */

/**
 * Completes the console's login screen (Console ADR 0003) with a seeded
 * user: the default-login flow's identifier step ("Email" + "Continue"),
 * then the password step ("Password" + "Sign in"). The widget exchanges the
 * handoff for the `__nextgen_session` cookie and performs a full-document
 * navigation away from /login.
 */
export async function signIn(
  page: Page,
  user: { email: string; password: string },
): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"));
}

/** Copy the route error boundaries render; none of it should appear on a pass. */
const ERROR_HEADINGS = ["Not authorized", "Something went wrong"];

/**
 * Asserts no error boundary rendered.
 *
 * Worth its own check because a boundary replaces the screen entirely: without
 * it, an assertion that some element is *absent* passes just as happily when the
 * whole route failed to load.
 */
export async function expectNoErrorBoundary(page: Page): Promise<void> {
  for (const heading of ERROR_HEADINGS) {
    await expect(page.getByText(heading, { exact: true })).toHaveCount(0);
  }
}
