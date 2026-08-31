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

  await page.waitForURL(/\/admin(?:[/?#]|$)/, { timeout: 30_000 });

  // The flow, not the kit, must have created the user (the project secret
  // scopes the list; the response pages the user documents under `users`).
  // `email` is a schema property, so it lives under `attributes` rather than
  // on the envelope.
  const { users } = await zitadel.api.listUsers({ limit: 100 });
  const created = users.find((user) => user.attributes.email === who.email);
  expect(created).toBeDefined();
});
