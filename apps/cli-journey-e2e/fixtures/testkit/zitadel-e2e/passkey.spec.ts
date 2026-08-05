import {
  expect,
  loginWithPasskey,
  registerWithPasskey,
  test,
} from "@zitadel/testing/playwright";

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
  await registerWithPasskey(page, { email: who.email });
  await page.waitForURL(/\/profile(?:[/?#]|$)/, { timeout: 30_000 });
  await expect.poll(() => passkey.credentialCount()).toBe(1);

  await page.context().clearCookies();
  await page.goto("/login");
  await expect(page.getByLabel(/email/i)).toBeVisible({ timeout: 30_000 });
  await loginWithPasskey(page, { email: who.email });
  await page.waitForURL(/\/profile(?:[/?#]|$)/, { timeout: 30_000 });

  // Login reused the registered credential instead of minting another.
  await expect.poll(() => passkey.credentialCount()).toBe(1);
});
