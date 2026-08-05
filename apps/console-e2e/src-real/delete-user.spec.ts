import type { Page } from "@playwright/test";
import { expect, test } from "@zitadel/testing/playwright";

import { expectNoErrorBoundary, signIn } from "./support";

/**
 * End-to-end coverage for the delete-user dialog (issue #632) against a real
 * instance.
 *
 * The unit specs cover the confirmation gate and the error path with a stubbed
 * API. What only a live backend proves is that `DELETE /users/{user_id}` is
 * actually reached with the console's project scope, that the delete is a real
 * one (the row does not come back on reload), and that the list the operator is
 * left looking at reflects it.
 */

test.describe.configure({ mode: "parallel" });

/** Signs in as `actor` and lands on the users list. */
async function openList(page: Page, actor: { email: string; password: string }): Promise<void> {
  await signIn(page, actor);
  await page.goto("/users");
  await expect(page.getByRole("heading", { name: "Users", exact: true })).toBeVisible();
}

/** Opens the delete dialog from the row menu of `name`. */
async function openDeleteDialog(page: Page, name: string) {
  await page.getByRole("button", { name: `Actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: `Delete ${name}?` });
  await expect(dialog).toBeVisible();
  return dialog;
}


test("deletes a user for real and drops it from the list", async ({ page, seed }) => {
  // Two users: one to sign in as, one to delete. Deleting the signed-in user
  // would end the session mid-test and prove something else entirely.
  const actor = await seed.user();
  const victim = await seed.user();
  await openList(page, actor);

  const dialog = await openDeleteDialog(page, victim.email);
  await dialog.getByRole("textbox", { name: "Type DELETE to confirm" }).fill("DELETE");
  await dialog.getByRole("button", { name: "Delete user", exact: true }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText(`${victim.email} deleted`)).toBeVisible();
  await expect(page.getByRole("link", { name: victim.email })).toHaveCount(0);

  // The delete is a hard delete server-side, so it must survive a reload — a row
  // that reappears would mean the list was only optimistically updated.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Users", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: victim.email })).toHaveCount(0);
  await expectNoErrorBoundary(page);
});

test("keeps the confirm action locked until DELETE is typed exactly", async ({ page, seed }) => {
  const actor = await seed.user();
  const victim = await seed.user();
  await openList(page, actor);

  const dialog = await openDeleteDialog(page, victim.email);
  const confirm = dialog.getByRole("button", { name: "Delete user", exact: true });
  const input = dialog.getByRole("textbox", { name: "Type DELETE to confirm" });

  await expect(confirm).toBeDisabled();
  await input.fill("delete");
  await expect(confirm).toBeDisabled();
  await input.fill("DELETE ");
  await expect(confirm).toBeDisabled();
  await input.fill("DELETE");
  await expect(confirm).toBeEnabled();
});

test("cancelling leaves the user in place", async ({ page, seed }) => {
  const actor = await seed.user();
  const victim = await seed.user();
  await openList(page, actor);

  const dialog = await openDeleteDialog(page, victim.email);
  await dialog.getByRole("textbox", { name: "Type DELETE to confirm" }).fill("DELETE");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole("link", { name: victim.email })).toBeVisible();

  // Re-opening starts from a blank confirmation rather than the typed one.
  const reopened = await openDeleteDialog(page, victim.email);
  await expect(reopened.getByRole("textbox", { name: "Type DELETE to confirm" })).toHaveValue("");
  await expect(reopened.getByRole("button", { name: "Delete user", exact: true })).toBeDisabled();
});

test("the row menu offers only actions the API can serve", async ({ page, seed }) => {
  // Edit user (#693), Deactivate (#553) and Reset password were rendering as
  // live controls with nothing behind them; they are out until they work.
  const actor = await seed.user();
  const victim = await seed.user();
  await openList(page, actor);

  await page.getByRole("button", { name: `Actions for ${victim.email}` }).click();
  const menu = page.getByRole("menu", { name: `Actions for ${victim.email}` });
  await expect(menu.getByRole("menuitem")).toHaveText(["View details", "Delete"]);
});
