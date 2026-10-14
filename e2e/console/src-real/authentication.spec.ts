import { expect, test } from "@zitadel/testing/playwright";

import { createIdpConnection, expectNoErrorBoundary, signIn } from "./support";

/**
 * The Authentication screen against a real instance, read on the session
 * cookie alone (#1621).
 *
 * What the unit specs cannot cover is the real response shape: the
 * `definition` nesting the list and the detail read, and the slug matching
 * between a schema's `sso.providers` and a connection. The bootstrapped schema
 * lists no provider, so the connection is in the project but no schema uses
 * it — `Not used` on the list, and no row on Sign-in methods, is what a fresh
 * project shows.
 *
 * Read-only apart from the connection the test writes through the API, which
 * no other spec reads.
 */

const CONNECTION = { slug: "e2e-google", display_name: "E2E Google", template: "google" };

test("lists a connection with its schemas and opens its detail", async ({
  page,
  zitadel,
  seed,
}) => {
  const created = await createIdpConnection(zitadel.handle, CONNECTION);
  await signIn(page, zitadel.handle, await seed.user());

  await page.goto("/authentication?tab=identity-providers");
  const row = page.getByRole("row").filter({ hasText: CONNECTION.display_name });
  await expect(row).toContainText("Not used");

  await row.getByRole("link", { name: CONNECTION.display_name }).click();
  await expect(page.getByRole("heading", { name: CONNECTION.display_name })).toBeVisible();
  await expect(page.getByText(created.id, { exact: true })).toBeVisible();
  await expect(page.getByText(CONNECTION.slug, { exact: true })).toBeVisible();
  // A `${{ VAR }}` reference is shown as written, not resolved.
  await expect(page.getByText("${{ E2E_CLIENT_ID }}", { exact: true })).toBeVisible();
  await expect(page.getByText("Not used", { exact: true })).toHaveCount(2);
  await expect(page.getByRole("tab", { name: "JSON" })).toBeVisible();

  await expectNoErrorBoundary(page);
});

test("lists the methods in use, without a connection no schema lists", async ({
  page,
  zitadel,
  seed,
}) => {
  await createIdpConnection(zitadel.handle, CONNECTION);
  await signIn(page, zitadel.handle, await seed.user());

  await page.goto("/authentication");
  await expect(page.getByRole("tab", { name: "Sign-in methods", selected: true })).toBeVisible();
  // The bootstrapped schema enables both plain methods and no provider.
  await expect(page.getByRole("row").filter({ hasText: "Passkey" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Password" })).toBeVisible();
  await expect(page.getByText(CONNECTION.display_name)).toHaveCount(0);

  await expectNoErrorBoundary(page);
});
