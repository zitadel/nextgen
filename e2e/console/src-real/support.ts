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
 */
export async function grantProjectAdmin(handle: ProjectHandle, userId: string): Promise<void> {
  await postWithProjectSecret(handle, "/grants", {
    user: { user_id: userId },
    relation: "admin",
  });
}

/**
 * Writes an identity provider connection to the instance's project. Writes
 * stay secret-only (#998), so a spec arranges one here rather than through the
 * read-only screen. The same slug again appends a revision, so a retried or
 * parallel test reuses the connection instead of failing on it.
 */
export async function createIdpConnection(
  handle: ProjectHandle,
  idp: { slug: string; display_name: string; template?: string },
): Promise<{ id: string }> {
  return postWithProjectSecret(handle, "/idps", {
    idp: {
      ...idp,
      protocol: "oidc",
      oidc: {
        issuer: "https://accounts.google.com",
        client_id: "${{ E2E_CLIENT_ID }}",
        client_secret: "${{ E2E_CLIENT_SECRET }}",
        scopes: ["openid", "profile", "email"],
      },
    },
  }) as Promise<{ id: string }>;
}

/**
 * `POST <path>?project_id=…` with the boot-captured project secret, from the
 * test process — the browser must not see it (see the credential-leak spec).
 */
async function postWithProjectSecret(
  handle: ProjectHandle,
  path: string,
  body: unknown,
): Promise<unknown> {
  const query = new URLSearchParams({ project_id: handle.projectId });
  const response = await fetch(`${handle.baseUrl}${path}?${query.toString()}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${handle.projectSecret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`POST ${path} answered ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

/**
 * The titles the console's error states render (`components/boundaries.tsx`);
 * none of them should appear on a pass. One list for every lane: a state left
 * off it — "Console API not authorized" once was — lets a refused request
 * pass as a loaded screen.
 */
const ERROR_STATES = [
  /^Request failed \(\d+\)$/,
  /^Not authorized$/,
  /^Console API not authorized$/,
  /^Something went wrong$/,
  /^Not found$/,
];

/**
 * Asserts no error boundary rendered.
 *
 * Worth its own check because a boundary replaces the screen entirely: without
 * it, an assertion that some element is *absent* passes just as happily when the
 * whole route failed to load.
 */
export async function expectNoErrorBoundary(page: Page): Promise<void> {
  for (const title of ERROR_STATES) {
    await expect(page.getByText(title)).toHaveCount(0);
  }
}
