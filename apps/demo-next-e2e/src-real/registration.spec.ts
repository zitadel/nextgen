import type { Page } from "@playwright/test";

import { expect, registerWithPassword, test } from "@zitadel/testing/playwright";

/**
 * Registration through the real flow with a kit-minted unused identity:
 * `seed.identity()` creates nothing, so the flow itself must create the user —
 * verified through the API afterwards.
 */
test("a fresh identity registers through the real flow", async ({ page, seed, zitadel }) => {
  const who = seed.identity();

  await page.goto("/login");
  await registerWithPassword(page, { email: who.email, password: who.password });
  await skipPasskeyUpsellIfVisible(page);

  await page.waitForURL(/\/admin(?:[/?#]|$)/, { timeout: 30_000 });

  // The flow, not the kit, must have created the user (the project secret
  // scopes the list; the response pages the user documents under `users`).
  // `email` is a schema property, so it lives under `attributes` rather than
  // on the envelope.
  const { users } = await zitadel.api.listUsers({ limit: 100 });
  const created = users.find((user) => user.attributes.email === who.email);
  expect(created).toBeDefined();
});

async function skipPasskeyUpsellIfVisible(page: Page): Promise<void> {
  const skip = page.getByRole("button", { name: /skip for now/i });
  const outcome = await Promise.race([
    skip.waitFor({ state: "visible", timeout: 30_000 }).then(() => "upsell" as const),
    page
      .waitForURL(/\/admin(?:[/?#]|$)/, { timeout: 30_000 })
      .then(() => "done" as const),
  ]);
  if (outcome === "upsell") {
    await skip.click();
  }
}
