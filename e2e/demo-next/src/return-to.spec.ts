import type { Page } from "@playwright/test";
import { expect, widgetTest as test } from "@zitadel/testing/playwright";

/**
 * Return to the protected route after sign-in. `nextgenMiddleware` sends a
 * signed-out request for a protected route to `/login?next=<path and query>`,
 * and `<zitadel-login>` returns there once the session cookie is set, instead of
 * going to its `post-sign-in-url` (`/admin` in this demo). Which values the
 * widget refuses is covered in `packages/components`; this proves the two
 * halves agree across a real Next middleware and full-page navigation.
 */

/** The two-step sign-in of the default flow, as in `auth.spec.ts`. */
async function signIn(page: Page): Promise<void> {
  await page.getByLabel(/email/i).fill("alice@acme.com");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("textbox", { name: /password/i }).fill("hunter2");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("returns to the protected route a signed-out visit started on, with its query", async ({
  page,
}) => {
  await page.goto("/dashboard?tab=billing");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard%3Ftab%3Dbilling$/);

  await signIn(page);

  await page.waitForURL(/\/dashboard\?tab=billing$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

test("goes to post-sign-in-url when next names another site", async ({ page }) => {
  await page.goto("/login?next=%2F%2Fevil.example");

  await signIn(page);

  await page.waitForURL("**/admin", { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
});
