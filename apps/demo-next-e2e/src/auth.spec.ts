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
 * 5. `nextgenMiddleware` validates the opaque session cookie via
 *    `GET /sessions/me` and the client-side `SessionDetails` component
 *    fetches the email through the `/__nextgen` proxy.
 * 6. The root layout seeds `NextgenProvider` from `auth()` and the client
 *    `UserBadge` renders the identity via `useAuth()` — while the raw
 *    session token stays out of the server response entirely (the provider
 *    strips it before the RSC boundary).
 *
 * Anything narrower (form participation, exchange call shape, atom focus)
 * is covered in `packages/components`'s Vitest suite.
 */
test("signs in via the embedded component and lands on /admin", async ({ page }) => {
  await page.goto("/login");

  // Split sign-in, matching the real default flow: `identifier` collects the
  // email, then `password` collects the credential. Both steps label their
  // primary action "Sign in", so this is the same two-click walk the
  // real-instance suites use.
  const email = "alice@acme.com";
  await page.getByLabel(/email/i).fill(email);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await page.getByLabel(/password/i).fill("hunter2");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await page.waitForURL("**/admin", { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
  // SessionDetails component fetches /sessions/me and renders identity + details.
  await expect(page.getByText(/Signed in as user_/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Session details")).toBeVisible();

  const sessionCookie = (await page.context().cookies()).find(
    (c) => c.name === "__nextgen_session",
  );
  expect(sessionCookie?.value).toBeTruthy();
  expect(sessionCookie?.httpOnly).toBe(true);

  // Layout-seeded auth state: the client UserBadge shows the email that
  // auth()'s /sessions/me validation resolved server-side.
  await expect(page.getByText(email)).toBeVisible();

  // Leak guard: the raw session token must never appear anywhere in the
  // server's response for the page — not in the HTML and not in the inlined
  // RSC flight payload. NextgenProvider strips it server-side; a regression
  // here means the token is readable by any script on the page.
  const response = await page.request.get("/admin");
  expect(response.ok()).toBe(true);
  const html = await response.text();
  expect(html).not.toContain(sessionCookie!.value);
});
