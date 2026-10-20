import { expect, widgetTest as test } from "@zitadel/testing/playwright";

/**
 * Middleware redirect contract. The Vitest suite stubs the SDK; this test
 * exercises the real `nextgenMiddleware` running inside Next, including
 * its matcher config and the JWKS verification short-circuit.
 */
test("redirects unauthenticated requests to /admin back to /login", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeVisible();
});
