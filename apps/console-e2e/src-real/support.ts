import type { Page } from "@playwright/test";

import { expect } from "@zitadel/testing/playwright";

import { completeLogin } from "./login";

/**
 * Shared helpers for the real-instance console suites.
 *
 * `signIn` had been copied verbatim into all three spec files. It is the one
 * step every real-instance test starts with, so a drift between copies would
 * mean the suites were signing in differently while looking identical.
 */

/** The instance handle fields the helpers here need. */
type ProjectHandle = { baseUrl: string; projectId: string; projectSecret: string };

/**
 * Grants a seeded user admin on the instance's project, then signs in with it
 * through the console's login screen (`completeLogin` in `login.ts`).
 */
export async function signIn(
  page: Page,
  handle: ProjectHandle,
  user: { id: string; email: string; password: string },
): Promise<void> {
  // The console authenticates with the session cookie alone (#1300): what a
  // person sees is what their grants allow, so every signed-in test user is
  // made an admin of the instance's project first.
  await grantProjectAdmin(handle, user.id);
  await completeLogin(page, user);
}

/**
 * Makes a seeded user an admin of the instance's project, through the API.
 *
 * A seeded user can sign in to the console but holds no grant, and the console
 * lists only the projects a person can act on (`GET /users/me/projects`,
 * #1237) — so without this the project pill and the Projects screen are
 * honestly empty. The grant is the same one a project's admins section creates.
 *
 * Written with the boot-captured project secret from the test process, never
 * from the page: the browser must not see it (see the credential-leak spec).
 */
export async function grantProjectAdmin(handle: ProjectHandle, userId: string): Promise<void> {
  const query = new URLSearchParams({ project_id: handle.projectId });
  const response = await fetch(`${handle.baseUrl}/grants?${query.toString()}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${handle.projectSecret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ user: { user_id: userId }, relation: "admin" }),
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
