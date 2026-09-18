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

  // The URL leaving /login is not the end of signing in. The widget's terminal
  // step is a full-document navigation to postSignInUrl, and the `_authed`
  // guard resolves the session again on the way into the layout. Returning at
  // the URL change leaves those in flight, and they interrupt whatever the
  // caller navigates to next ("Navigation to /x is interrupted by another
  // navigation to /"). The shell's own navigation renders only once the guard
  // has let the layout through, so waiting for it waits for the sign-in to
  // have finished landing.
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
}

/**
 * Makes a seeded user an admin of the instance's project, through the API.
 *
 * A seeded user can sign in to the console but holds no grant, and the console
 * lists only the projects a person can act on (`GET /users/me/projects`,
 * #1237) — so without this the project pill and the Projects screen are
 * honestly empty. The grant is the same one Settings → Admins creates.
 *
 * Written with the boot-captured project secret from the test process, never
 * from the page: the browser must not see it (see the credential-leak spec).
 */
export async function grantProjectAdmin(
  handle: { baseUrl: string; projectId: string; projectSecret: string },
  userId: string,
): Promise<void> {
  const query = new URLSearchParams({ project_id: handle.projectId });
  const response = await fetch(`${handle.baseUrl}/grants?${query.toString()}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${handle.projectSecret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ principal_type: "user", principal_id: userId, relation: "admin" }),
  });
  if (!response.ok) {
    throw new Error(`POST /grants answered ${response.status}: ${await response.text()}`);
  }
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
