/* oxlint-disable playwright/no-conditional-in-test -- the registration choice
   only re-asks for the email on some flow configs; fill it when it renders. */
import { expect, test } from "@zitadel/testing/playwright";

/**
 * Passkey round-trip with the kit's virtual authenticator: register a fresh
 * identity with a passkey through the app-embedded flow, then sign back in
 * with it. The whole trip stays on one page — the credential lives in the
 * page-bound virtual authenticator, so signing out means clearing cookies,
 * not opening a fresh context. Chromium only.
 */
test("a fresh identity registers and signs in with a passkey", async ({
  page,
  seed,
  passkey,
}) => {
  const who = seed.identity();

  await page.goto("/login");
  await page.getByLabel(/email/i).fill(who.email);
  await page
    .getByRole("button", { name: /continue|sign in/i })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: /create|register|sign up|no-account/i }),
  ).toBeVisible({ timeout: 30_000 });
  const emailAgain = page.getByLabel(/email/i).first();
  if (await emailAgain.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await emailAgain.fill(who.email);
  }
  await page.getByRole("button", { name: /passkey/i }).first().click();
  await page.waitForURL(/\/profile(?:[/?#]|$)/, { timeout: 30_000 });
  await expect.poll(() => passkey.credentialCount()).toBe(1);

  await page.context().clearCookies();
  await page.goto("/login");
  await expect(page.getByLabel(/email/i)).toBeVisible({ timeout: 30_000 });
  await page.getByLabel(/email/i).fill(who.email);
  await page.getByRole("button", { name: /passkey/i }).first().click();
  await page.waitForURL(/\/profile(?:[/?#]|$)/, { timeout: 30_000 });

  // Login reused the registered credential instead of minting another.
  await expect.poll(() => passkey.credentialCount()).toBe(1);
});
