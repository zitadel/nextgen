import type { Page } from "@playwright/test";

/**
 * Completes the console's login screen (Console ADR 0003) as `user`: the
 * default-login flow's identifier step ("Email" + "Continue"), then the
 * password step ("Password" + "Sign in"). The widget exchanges the handoff for
 * the `__nextgen_session` cookie and performs a full-document navigation away
 * from /login.
 *
 * Only the login, not the grant `signIn` in `support.ts` writes first, and
 * free of the test runner: `scripts/screenshot-grid.mts` signs in with it too,
 * outside Playwright Test, so this waits on locators rather than `expect`.
 *
 * `loginUrl` is `/login` against the page's `baseURL`; a caller without one
 * passes the absolute URL.
 */
export async function completeLogin(
  page: Page,
  user: { email: string; password: string },
  loginUrl = "/login",
): Promise<void> {
  await page.goto(loginUrl);
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
  await page.getByRole("navigation", { name: "Primary" }).waitFor();
}
