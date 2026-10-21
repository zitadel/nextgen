import { expect, test } from "@zitadel/testing/playwright";

import { expectNoErrorBoundary } from "../support/screens";
import { signIn } from "../support/sign-in";

/**
 * The user detail screen's Save against a real instance.
 *
 * The unit specs cover which attributes a save sends. What only a live backend
 * proves is that `PATCH /users/{user_id}` takes the session cookie and its CSRF
 * token, and that the change is stored rather than only shown.
 */

test("saves a user's attribute and keeps it across a reload", async ({ page, zitadel, seed }) => {
  const actor = await seed.user();
  const subject = await seed.user();
  await signIn(page, zitadel, actor);
  await page.goto("/users");
  await page.getByRole("link", { name: subject.email }).click();
  await expect(page.getByRole("heading", { name: subject.email })).toBeVisible();

  const save = page.getByRole("button", { name: "Save" });
  await expect(save).toBeDisabled();
  const renamed = `renamed-${subject.email}`;
  await page.getByLabel("Email").fill(renamed);
  await save.click();

  // The heading is the server-resolved identifier, so it changes only once the
  // loader reads the stored user back.
  await expect(page.getByRole("heading", { name: renamed })).toBeVisible();
  await expect(save).toBeDisabled();
  await page.reload();
  await expect(page.getByLabel("Email")).toHaveValue(renamed);
  await expectNoErrorBoundary(page);
});
