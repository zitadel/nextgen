import type { Page } from "@playwright/test";
import {
  expect,
  loginWithPassword,
  sessionCookieName,
  test,
  type SeededUser,
} from "@zitadel/testing/playwright";

async function expectAuthenticatedAs(
  page: Page,
  user: SeededUser,
  projectId: string,
): Promise<void> {
  await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
  // Default schema: email identifier, no display — the line shows the email.
  await expect(page.getByText(`Signed in as ${user.email}`)).toBeVisible();
  // The SDK keeps the session under the project's name (ADR 073).
  const cookies = await page.context().cookies();
  const session = cookies.find((cookie) => cookie.name === sessionCookieName(projectId));
  expect(session).toBeDefined();
  expect(session?.httpOnly).toBe(true);
}

test("seeded user completes the password login flow", async ({ page, seed, zitadel }) => {
  const user = await seed.user();
  await page.goto("/login");
  // The real two-step flow (identifier -> password), driven by the
  // `default-login` flow definition the kit bootstrapped on the instance.
  await loginWithPassword(page, user);
  await page.waitForURL("**/admin", { timeout: 20_000 });
  await expectAuthenticatedAs(page, user, zitadel.handle.projectId);
});
