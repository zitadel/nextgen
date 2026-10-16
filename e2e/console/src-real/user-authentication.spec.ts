import { expect, test } from "@zitadel/testing/playwright";

import { expectNoErrorBoundary } from "../support/screens";
import { signIn } from "../support/sign-in";

/**
 * The user detail screen's Authentication tab against a real instance.
 *
 * The unit specs cover what the tab renders for each answer. What only a live
 * backend proves is that the session cookie alone is enough for both of its
 * reads: a refused `GET /users/{id}/passkeys` or `GET /users/{id}/identity_links`
 * renders "Could not be loaded" rather than failing the screen, so the tab has
 * to show the real answers here.
 */

test("reads a user's passkeys and linked accounts on the session", async ({
  page,
  zitadel,
  seed,
}) => {
  const actor = await seed.user();
  const subject = await seed.user();
  await signIn(page, zitadel, actor);
  await page.goto("/users");
  await page.getByRole("link", { name: subject.email }).click();
  await expect(page.getByRole("heading", { name: subject.email })).toBeVisible();

  await page.getByRole("tab", { name: "Authentication" }).click();
  const panel = page.getByRole("tabpanel");
  await expect(panel.getByText("Not set up")).toBeVisible();
  // A seeded user has signed in through no provider; the link list itself is
  // what has to come back.
  await expect(panel.getByText("No identity provider is linked to this user.")).toBeVisible();
  await expect(panel.getByText("Could not be loaded")).toHaveCount(0);
  await expectNoErrorBoundary(page);
});
