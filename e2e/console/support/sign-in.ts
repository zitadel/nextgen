import type { Page } from "@playwright/test";
import { type ConnectedZitadel, loginWithPassword } from "@zitadel/testing/playwright";

import { grantProjectAdmin } from "./api";

/** The console's login screen under the embed base, where the binary serves it. */
export const EMBEDDED_LOGIN_URL = "/ui/console/login";

/**
 * Grants a seeded user admin on the instance's project, then signs in with it
 * through the console's login screen (`completeLogin`). It is the one step
 * nearly every console test starts with: one copy, so the suites cannot drift
 * into signing in differently while looking identical.
 *
 * The console authenticates with the session cookie alone (#1300): what a
 * person sees is what their grants allow, hence the grant first.
 */
export async function signIn(
  page: Page,
  zitadel: ConnectedZitadel,
  user: { id: string; email: string; password: string },
  loginUrl?: string,
): Promise<void> {
  await grantProjectAdmin(zitadel, user.id);
  await completeLogin(page, user, loginUrl);
}

/**
 * Completes the console's login screen (Console ADR 0003) as `user`, through
 * the kit's `loginWithPassword`: the default-login flow's identifier step,
 * then its password step. The widget exchanges the handoff for the
 * `__nextgen_session` cookie and performs a full-document navigation away
 * from /login.
 *
 * Only the login, not the grant `signIn` writes first, and free of the test
 * runner: `scripts/screenshot-grid.mts` signs in with it too, outside
 * Playwright Test, so this waits on locators rather than `expect`.
 *
 * `loginUrl` is `/login` against the page's `baseURL` (the dev-proxy lane); the
 * binary-served lanes pass `EMBEDDED_LOGIN_URL`, a caller without a `baseURL`
 * the absolute URL.
 */
export async function completeLogin(
  page: Page,
  user: { email: string; password: string },
  loginUrl = "/login",
): Promise<void> {
  await page.goto(loginUrl);
  // The kit returns right after the last click, without waiting for anything.
  await loginWithPassword(page, user);
  await page.waitForURL((url) => !url.pathname.endsWith("/login"));

  // The URL leaving /login is not the end of signing in. The widget's terminal
  // step is a full-document navigation to postSignInUrl, and the `_authed`
  // guard resolves the session again on the way into the layout. Returning at
  // the URL change leaves those in flight, and they interrupt whatever the
  // caller navigates to next ("Navigation to /x is interrupted by another
  // navigation to /"). The shell's account menu renders only once the guard
  // has let the layout through, so waiting for it waits for the sign-in to
  // have finished landing. The account menu rather than the sidebar: the
  // landing may be Projects, the home, which draws no sidebar.
  await page.getByRole("button", { name: /^Account:/ }).waitFor();
}
