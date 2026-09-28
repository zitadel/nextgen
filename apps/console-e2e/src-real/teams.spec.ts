import { expect, test } from "@zitadel/testing/playwright";

import { expectNoErrorBoundary, signIn } from "./support";

/**
 * End-to-end coverage for the Teams screens against a real instance.
 *
 * The unit specs drive these flows over stubbed responses, which proves the
 * component's behaviour but not the round trip. These cover what only a live
 * backend shows: that a team created through the drawer really reaches
 * `POST /teams` and comes back in the list, that a rename persists through
 * `PATCH /teams/{team_id}`, and that the status column reflects what the server
 * stamped rather than what the console assumed.
 */

test.describe.configure({ mode: "parallel" });

/** A name unique per test, so the parallel workers never collide on the project's unique-name rule. */
function teamName(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

test("creates a team through the drawer and lists it", async ({ page, seed }) => {
  await signIn(page, await seed.user());
  const name = teamName("acme");

  await page.goto("/teams");
  await expect(page.getByRole("heading", { name: "Teams", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Add", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Add team" });
  await expect(drawer).toBeVisible();

  // The submit stays disabled until the one required field has a value.
  await expect(drawer.getByRole("button", { name: "Add team", exact: true })).toBeDisabled();
  await drawer.getByLabel("Team name").fill(name);
  await drawer.getByRole("button", { name: "Add team", exact: true }).click();

  await expect(drawer).toBeHidden();
  await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  await expectNoErrorBoundary(page);
});

test("opens a team from the list and renames it", async ({ page, seed }) => {
  await signIn(page, await seed.user());
  const name = teamName("rename");
  const renamed = `${name}-renamed`;

  await page.goto("/teams");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Add team" });
  await drawer.getByLabel("Team name").fill(name);
  await drawer.getByRole("button", { name: "Add team", exact: true }).click();

  await page.getByRole("link", { name, exact: true }).click();
  await expect(page).toHaveURL(/\/teams\/team_[A-Z0-9]+$/);
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();

  const field = page.getByLabel("Tenant name");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await field.fill(renamed);
  await page.getByRole("button", { name: "Save", exact: true }).click();

  // The save re-runs the loader, so the heading follows the record rather than
  // the field's draft — that is what proves the PATCH landed.
  await expect(page.getByRole("heading", { name: renamed, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await expectNoErrorBoundary(page);
});

test("shows the status the API stamped on a team", async ({ page, seed }) => {
  await signIn(page, await seed.user());
  const name = teamName("status");

  await page.goto("/teams");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Add team" });
  await drawer.getByLabel("Team name").fill(name);
  await drawer.getByRole("button", { name: "Add team", exact: true }).click();

  // `team-status` returns `active`; the console renders that value rather than
  // the design's `Inactive`/`Active` wording, so this asserts the API's own word.
  const row = page.getByRole("row").filter({ hasText: name });
  await expect(row.getByText("active", { exact: true })).toBeVisible();
});
