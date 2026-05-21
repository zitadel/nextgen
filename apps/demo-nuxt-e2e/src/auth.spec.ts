import { expect, test } from "@playwright/test";

/**
 * Embedded sign-in happy path on Nuxt. Proves the boundary that Vitest
 * cannot:
 *
 * 1. The Lit `<zitadel-login>` element mounts inside `<ClientOnly>` after
 *    Nuxt's SSR pass.
 * 2. Form interactions reach the orchestrator across atom shadow roots.
 * 3. The terminal step's internal `POST /sessions/exchange` traverses the
 *    Nitro `/__nextgen` proxy installed by `@nextgen/sdk-nuxt` and the
 *    api-mock RS256 verification.
 * 4. `__nextgen_session` is set on the demo origin and `<zitadel-login>`'s
 *    full-page navigation lands on the protected `/admin` route.
 * 5. The Nitro auth middleware accepts the cookie on the next request
 *    and the page renders the captured email.
 *
 * Anything narrower (form participation, exchange call shape, atom focus)
 * is covered in `packages/components`'s Vitest suite.
 */
test("signs in via the embedded component and lands on /admin", async ({ page }) => {
  await page.goto("/login");

  const email = "alice@acme.com";
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill("hunter2");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: /skip for now/i }).click();

  await page.waitForURL("**/admin");
  await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();

  const sessionCookie = (await page.context().cookies()).find(
    (c) => c.name === "__nextgen_session",
  );
  expect(sessionCookie?.value).toBeTruthy();
  expect(sessionCookie?.httpOnly).toBe(true);
});
