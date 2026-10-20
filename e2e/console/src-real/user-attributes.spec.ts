import { expect, test } from "@zitadel/testing/playwright";

import { expectNoErrorBoundary } from "../support/screens";
import { signIn } from "../support/sign-in";

/**
 * Saving a user's attributes from the user detail screen against a real
 * instance.
 *
 * The unit specs cover which attributes the form sends. What only a live
 * backend proves is that the session cookie alone authorizes
 * `PATCH /users/{user_id}` through the dev proxy, and that the API reads the
 * change back.
 */

test("saves a changed attribute of a user", async ({ page, zitadel, seed }) => {
  const actor = await seed.user();
  const subject = await seed.user();
  // `email` is the one property every seeded schema defines.
  const email = seed.identity().email;
  await signIn(page, zitadel, actor);
  await page.goto("/users");
  await page.getByRole("link", { name: subject.email }).click();
  await expect(page.getByRole("heading", { name: subject.email })).toBeVisible();

  const panel = page.getByRole("tabpanel");
  const save = panel.getByRole("button", { name: "Save", exact: true });
  await expect(save).toBeDisabled();
  await panel.getByLabel("Email").fill(email);
  await save.click();

  // The save re-runs the loader, so the heading follows the stored email. A
  // refusal shows the server's message instead, read out so a failure names it.
  const alert = panel.getByRole("alert");
  await expect(page.getByRole("heading", { name: email }).or(alert)).toBeVisible();
  expect(await alert.allTextContents()).toEqual([]);

  const stored = (await zitadel.api.getUserByID(subject.id)) as {
    attributes?: Record<string, unknown>;
  };
  expect(stored.attributes?.email).toBe(email);
  await expectNoErrorBoundary(page);
});
