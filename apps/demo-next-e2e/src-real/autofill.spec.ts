import type { Locator, Page } from "@playwright/test";

import { expect, test } from "@zitadel/testing/playwright";

/**
 * The autofill tokens across the two-step journeys, where the password is
 * asked for on a step of its own. The engine sends each token and the
 * identifier it already holds; these walk identifier -> password against the
 * real server to see both arrive in the rendered form.
 */

/** The identifier a password manager pairs with the password on this step. */
function pairedIdentifier(page: Page): Locator {
  return page
    .locator("form")
    .filter({ has: page.getByLabel(/password/i) })
    .locator('input[autocomplete="username"]');
}

test("sign-in tags each step and pairs the identifier with the password", async ({
  page,
  seed,
}) => {
  const user = await seed.user();

  await page.goto("/login");
  const email = page.getByLabel(/email/i);
  await expect(email).toHaveAttribute("autocomplete", "username");
  await email.fill(user.email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  const password = page.getByLabel(/password/i);
  await expect(password).toHaveAttribute("autocomplete", "current-password");
  await expect(pairedIdentifier(page)).toHaveValue(user.email);

  // The paired identifier is not a field the step declares, so the sign-in
  // completing shows it stayed out of the submission.
  await password.fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/admin", { timeout: 20_000 });
});

test("registration tags each step and pairs the identifier with the new password", async ({
  page,
  seed,
}) => {
  const who = seed.identity();

  await page.goto("/login");
  await page.getByRole("link", { name: "Sign up", exact: true }).click();
  const email = page.getByLabel(/email/i);
  await expect(email).toHaveAttribute("autocomplete", "username");
  await email.fill(who.email);
  await page.getByRole("button", { name: "Continue with password", exact: true }).click();

  await expect(page.getByLabel(/password/i)).toHaveAttribute("autocomplete", "new-password");
  await expect(pairedIdentifier(page)).toHaveValue(who.email);
});
