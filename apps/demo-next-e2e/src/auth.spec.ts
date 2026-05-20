import { expect, test } from "@playwright/test";

/**
 * Embedded sign-in happy path. Proves the boundary that Vitest cannot:
 *
 * 1. The Lit `<zitadel-login>` element mounts inside Next's `dynamic({ ssr: false })`.
 * 2. Form interactions reach the orchestrator across atom shadow roots.
 * 3. The terminal step's internal `POST /sessions/exchange` traverses the
 *    Next.js `/__nextgen` proxy and the api-mock RS256 verification.
 * 4. `__nextgen_session` is set on the demo origin and `<zitadel-login>`'s
 *    full-page navigation lands on the protected `/admin` route.
 * 5. `nextgenMiddleware` accepts the cookie on the next request and
 *    `auth()` reports the captured email.
 *
 * Anything narrower (form participation, exchange call shape, atom focus)
 * is covered in `packages/components`'s Vitest suite.
 */
test("signs in via the embedded component and lands on /admin", async ({ page }) => {
  await page.goto("/login");

  const email = "alice@acme.com";
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill("hunter2");
  // Combined identifier step (email + password) — api-mock `identifierStep`.
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // Passkey upsell before handoff — skip matches mock + Vitest happy path.
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
