import { expect, loginWithPassword, test } from "@zitadel/testing/playwright";

/**
 * The kit's central promise in a scaffolded app: seed a user through the API,
 * then complete the real login through the app-embedded flow that
 * `zitadel setup` wired up.
 */
test("a seeded user signs in with their password", async ({ page, seed }) => {
  const user = await seed.user();

  await page.goto("/login");
  await loginWithPassword(page, user);

  await page.waitForURL(/\/profile(?:[/?#]|$)/, { timeout: 30_000 });
  const session = (await page.context().cookies()).find(
    (cookie) => cookie.name === "__nextgen_session",
  );
  expect(session).toBeDefined();
  expect(session?.httpOnly).toBe(true);
});
