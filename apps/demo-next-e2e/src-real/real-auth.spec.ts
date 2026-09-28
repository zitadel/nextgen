import type { Page } from "@playwright/test";
import { expect, test, type SeededUser } from "@zitadel/testing/playwright";

/**
 * The real login flow is two-step (identifier -> password), driven by the
 * `default-login` flow definition the kit bootstrapped on the instance.
 */
async function loginWithPassword(page: Page, user: SeededUser): Promise<void> {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(user.email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel(/password/i).fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/admin", { timeout: 20_000 });
}

async function expectAuthenticatedAs(page: Page, user: SeededUser): Promise<void> {
  await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
  // Default schema: email identifier, no display — the line shows the email.
  await expect(page.getByText(`Signed in as ${user.email}`)).toBeVisible();
  const cookies = await page.context().cookies();
  const session = cookies.find((cookie) => cookie.name === "__nextgen_session");
  expect(session).toBeDefined();
  expect(session?.httpOnly).toBe(true);
}

// Two tests, each minting its own user, running in parallel workers against
// the one shared instance: proves per-test seeding is isolation enough.
test("seeded user completes the password login flow", async ({ page, seed }) => {
  const user = await seed.user();
  await loginWithPassword(page, user);
  await expectAuthenticatedAs(page, user);
});

test("a second seeded user logs in independently in parallel", async ({ page, seed }) => {
  const user = await seed.user();
  await loginWithPassword(page, user);
  await expectAuthenticatedAs(page, user);
});
