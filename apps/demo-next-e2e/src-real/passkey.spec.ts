import { expect, test } from "@zitadel/testing/playwright";

import { clickAction, fillIfVisible } from "./flow-actions";

/**
 * Passkey round-trip through the real flow with the kit's virtual
 * authenticator: register a fresh identity with a passkey at the
 * registration-choice step (the default password-first flow offers it), then
 * sign back in with that passkey. The whole trip stays on one page — the
 * credential lives in the page-bound virtual authenticator, so signing out
 * means clearing cookies, not opening a fresh context.
 */
test("a fresh identity registers with a passkey and signs back in with it", async ({
  page,
  seed,
  passkey,
}) => {
  const who = seed.identity();

  await page.goto("/login");
  await page.getByLabel(/email/i).fill(who.email);
  await clickAction(page, /continue|sign in/i, ["submit"]);
  await expect(
    page.getByRole("heading", { name: /create|register|sign up|no-account/i }),
  ).toBeVisible({ timeout: 30_000 });

  await fillIfVisible(page, /email/i, who.email);
  await clickAction(page, /register.*passkey|passkey.*register|passkey_register/i, [
    "passkey_register",
  ]);
  await page.waitForURL(/\/admin(?:[/?#]|$)/, { timeout: 30_000 });
  await expect.poll(() => passkey.credentialCount()).toBe(1);

  await page.context().clearCookies();
  await page.goto("/login");
  // The login surface re-hydrates after the navigation; wait for the field
  // before driving it (the journey documents this race after redirects).
  await expect(page.getByLabel(/email/i)).toBeVisible({ timeout: 30_000 });
  await page.getByLabel(/email/i).fill(who.email);
  await clickAction(page, /sign in with.*passkey|passkey/i, ["passkey"]);
  await page.waitForURL(/\/admin(?:[/?#]|$)/, { timeout: 30_000 });

  // Login must reuse the registered credential, not mint another.
  await expect.poll(() => passkey.credentialCount()).toBe(1);
});
