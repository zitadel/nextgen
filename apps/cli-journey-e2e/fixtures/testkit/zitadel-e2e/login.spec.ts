import { expect, test } from "@zitadel/testing/playwright";

/**
 * The kit's central promise in a scaffolded app: seed a user through the API,
 * then complete the real two-step (identifier -> password) login through the
 * app-embedded flow that `zitadel setup` wired up.
 */
test("a seeded user signs in with their password", async ({ page, seed }) => {
  const user = await seed.user();

  await page.goto("/login");
  await page.getByLabel(/email/i).fill(user.email);
  await page
    .getByRole("button", { name: /continue|sign in/i })
    .first()
    .click();
  await page.getByLabel(/password/i).fill(user.password);
  await page
    .getByRole("button", { name: /continue|sign in/i })
    .first()
    .click();

  await page.waitForURL(/\/profile(?:[/?#]|$)/, { timeout: 30_000 });
  const session = (await page.context().cookies()).find(
    (cookie) => cookie.name === "__nextgen_session",
  );
  expect(session?.httpOnly).toBe(true);
});
