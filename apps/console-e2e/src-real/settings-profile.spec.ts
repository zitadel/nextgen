import { expect, test } from "@zitadel/testing/playwright";

import { expectNoErrorBoundary, signIn } from "./support";

/**
 * Settings → Profile, against a real instance.
 *
 * The unit spec stubs `GET /users/me`. This proves the signed-in person's own
 * record reaches the screen through the session cookie alone: the email shown
 * is the one the seeded user signed in with.
 */

test("shows the signed-in person's email, read-only", async ({ page, zitadel, seed }) => {
  const user = await seed.user();
  await signIn(page, zitadel.handle, user);

  await page.goto("/settings");

  await expect(page).toHaveURL(/\/settings\/profile/);
  await expect(page.getByRole("heading", { name: "Profile", exact: true })).toBeVisible();

  const email = page.getByLabel("Email address");
  await expect(email).toHaveValue(user.email);
  await expect(email).toBeDisabled();

  const account = page.getByRole("navigation", { name: "ACCOUNT" });
  await expect(account.getByRole("link", { name: "Profile" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("link", { name: "Back to dashboard" })).toBeVisible();
  await expectNoErrorBoundary(page);
});
