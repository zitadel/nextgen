import { expect, test } from "@zitadel/testing/playwright";

import { expectNoErrorBoundary } from "../support/screens";
import { signIn } from "../support/sign-in";

/**
 * Account settings → Settings (the profile), against a real instance.
 *
 * The unit spec stubs `GET /users/me`. This proves the signed-in person's own
 * record reaches the screen through the session cookie alone: the email shown
 * is the one the seeded user signed in with. The screen is generated from the
 * person's own user schema, so the row carries the schema's label (`Email`),
 * and it is read-only because it is the schema's `x-identifier`.
 */

test("shows the signed-in person's email, read-only", async ({ page, zitadel, seed }) => {
  const user = await seed.user();
  await signIn(page, zitadel, user);

  await page.goto("/settings/profile");

  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();

  const email = page.getByLabel("Email", { exact: true });
  await expect(email).toHaveValue(user.email);
  await expect(email).toBeDisabled();

  const nav = page.getByRole("navigation", { name: "Account settings" });
  await expect(nav.getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "Back to dashboard" })).toBeVisible();
  await expectNoErrorBoundary(page);
});
