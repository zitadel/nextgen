import type { Page } from "@playwright/test";
import { expect, test } from "@zitadel/testing/playwright";

import { expectNoErrorBoundary, signIn } from "./support";

/**
 * End-to-end coverage for the delete-user dialog (issue #632) against a real
 * instance.
 *
 * The unit specs cover the dialog itself with a stubbed API: the confirmation
 * gate, cancelling, the row menu and the error path
 * (`apps/console/src/components/delete-user-dialog.spec.tsx`). What only a live
 * backend proves is that `DELETE /users/{user_id}` is actually reached with the
 * console's project scope, that the delete is a real one (the row does not come
 * back on reload), and that the list the operator is left looking at reflects
 * it.
 */

/** Signs in as `actor` and lands on the users list. */
async function openList(
  page: Page,
  handle: Parameters<typeof signIn>[1],
  actor: Parameters<typeof signIn>[2],
): Promise<void> {
  await signIn(page, handle, actor);
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

test("deletes a user for real and drops it from the list", async ({ page, zitadel, seed }) => {
  // Two users: one to sign in as, one to delete. Deleting the signed-in user
  // would end the session mid-test and prove something else entirely.
  const actor = await seed.user();
  const victim = await seed.user();
  await openList(page, zitadel.handle, actor);

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
