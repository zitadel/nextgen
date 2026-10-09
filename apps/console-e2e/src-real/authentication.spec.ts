import { expect, test } from "@zitadel/testing/playwright";

import { createIdpConnection, expectNoErrorBoundary, signIn } from "./support";

/**
 * The Authentication screen against a real instance, read on the session
 * cookie alone (#1621).
 *
 * What the unit specs cannot cover is the real response shape: the
 * `definition` nesting the list and the detail read, and the slug matching
 * between a schema's `sso.providers` and a connection. The bootstrapped schema
 * lists no provider, so the connection is in the project but not enabled for
 * it — the Disabled row and "Not used" are what a fresh project shows.
 *
 * Read-only apart from the connection the test writes through the API, which
 * no other spec reads.
 */

const CONNECTION = { slug: "e2e-google", display_name: "E2E Google", template: "google" };

test("lists a connection and opens its detail", async ({ page, zitadel, seed }) => {
  const created = await createIdpConnection(zitadel.handle, CONNECTION);
  await signIn(page, zitadel.handle, await seed.user());

  await page.goto("/authentication?tab=identity-providers");
  const row = page.getByRole("row").filter({ hasText: CONNECTION.display_name });
  await expect(row).toContainText(CONNECTION.slug);
  await expect(row).toContainText("OIDC");

  await row.getByRole("link", { name: CONNECTION.display_name }).click();
  await expect(page.getByRole("heading", { name: CONNECTION.display_name })).toBeVisible();
  await expect(page.getByText(created.id, { exact: true })).toBeVisible();
  // A `${{ VAR }}` reference is shown as written, not resolved.
  await expect(page.getByText("${{ E2E_CLIENT_ID }}", { exact: true })).toBeVisible();
  await expect(page.getByText("Not used", { exact: true })).toHaveCount(2);
  await expect(page.getByRole("tab", { name: "JSON" })).toBeVisible();

  await expectNoErrorBoundary(page);
});

test("shows an unlisted connection as disabled for a schema", async ({ page, zitadel, seed }) => {
  await createIdpConnection(zitadel.handle, CONNECTION);
  await signIn(page, zitadel.handle, await seed.user());

  await page.goto("/authentication");
  await expect(page.getByRole("tab", { name: "Sign-in", selected: true })).toBeVisible();
  await page.getByRole("row").nth(1).getByRole("link").click();

  await expect(page.getByText("Allowed sign-in methods")).toBeVisible();
  const providerRow = page.getByText(CONNECTION.display_name, { exact: true }).locator("../..");
  await expect(providerRow).toContainText("Disabled");

  await expectNoErrorBoundary(page);
});
