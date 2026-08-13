import { expect, test } from "@playwright/test";

/**
 * Nitro middleware redirect contract. The Vitest suite stubs the SDK;
 * this test exercises `@zitadel/sdk-nuxt`'s real
 * `createNextgenMiddleware` running inside Nitro, including the JWKS
 * verification short-circuit.
 */
test("redirects unauthenticated requests to /admin back to /login", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeVisible();
});
