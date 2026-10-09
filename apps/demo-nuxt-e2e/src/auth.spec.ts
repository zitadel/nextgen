import { expect, test } from "@playwright/test";

/**
 * Embedded sign-in happy path on Nuxt. Proves the boundary that Vitest
 * cannot:
 *
 * 1. The Lit `<zitadel-login>` element mounts inside `<ClientOnly>` after
 *    Nuxt's SSR pass.
 * 2. Form interactions reach the orchestrator across atom shadow roots.
 * 3. The terminal step's internal `POST /sessions/exchange` traverses the
 *    Nitro `/__nextgen` proxy installed by `@zitadel/sdk-nuxt` and the
 *    api-mock RS256 verification.
 * 4. `__nextgen_session` is set on the demo origin and `<zitadel-login>`'s
 *    full-page navigation lands on the protected `/admin` route.
 * 5. `nextgenMiddleware` validates the opaque session cookie via
 *    `GET /sessions/me` and the client-side `SessionDetails` component
 *    fetches the user_id through the `/__nextgen` proxy.
 *
 * Anything narrower (form participation, exchange call shape, atom focus)
 * is covered in `packages/components`'s Vitest suite.
 */
test("signs in via the embedded component and lands on /admin", async ({ page }) => {
  await page.goto("/login");

  // Split sign-in, matching the real default flow: `identifier` collects the
  // email with "Continue", then `password` collects the credential with
  // "Sign in".
  const email = "alice@acme.com";
  await page.getByLabel(/email/i).fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  await page.getByLabel(/password/i).fill("hunter2");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await page.waitForURL("**/admin", { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
  // SessionDetails fetches /sessions/me and renders the user ref: the mock
  // schema designates no display for this identity, so the line shows the
  // signed-in identifier.
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Session details")).toBeVisible();

  const sessionCookie = (await page.context().cookies()).find(
    (c) => c.name === "__nextgen_session",
  );
  expect(sessionCookie?.value).toBeTruthy();
  expect(sessionCookie?.httpOnly).toBe(true);
});
