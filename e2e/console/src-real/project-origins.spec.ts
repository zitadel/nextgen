import { expect, test } from "@zitadel/testing/playwright";

import { withErrorBody } from "../support/api";
import { expectNoErrorBoundary, uniqueName } from "../support/screens";
import { signIn } from "../support/sign-in";

/**
 * The project page's origins and variables, against a real instance.
 *
 * The unit specs drive both over stubbed responses. These prove the round
 * trips: the server's refusal reaches the field, an origin added through the
 * dialog reaches the project and comes back on reload, a removal takes it
 * away again, and variables set through the API show up with a secret held
 * rather than shown.
 *
 * Every pattern and name is unique to the run, and each test removes what it
 * added: a standalone deployment has one project, which every other spec
 * reads.
 */

test("refuses a wildcard as primary, then adds, edits and removes an origin", async ({
  page,
  zitadel,
  seed,
}) => {
  await signIn(page, zitadel, await seed.user());
  const pattern = `https://${uniqueName("e2e")}.example.com`;
  const edited = `https://${uniqueName("e2e")}.example.org`;

  try {
    await page.goto(`/projects/${zitadel.handle.projectId}`);
    const section = page.getByRole("region", { name: "Origins" });
    await section.getByRole("button", { name: "Add origin" }).click();

    const dialog = page.getByRole("dialog");
    // A wildcard is not a primary origin. The server's refusal lands on the
    // field and the dialog stays: nothing was written.
    await dialog.getByRole("textbox", { name: "URL" }).fill("https://*.example.com");
    await dialog.getByRole("button", { name: "Add origin" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(/exact URL/);
    await expect(dialog).toBeVisible();

    await dialog.getByRole("textbox", { name: "URL" }).fill(pattern);
    await dialog.getByRole("button", { name: "Add origin" }).click();
    await expect(dialog).toBeHidden();

    // The row is the record re-read, not the draft: it survives a reload.
    await expect(section.getByRole("link", { name: pattern })).toBeVisible();
    await page.reload();
    await expect(section.getByRole("link", { name: pattern })).toBeVisible();

    // An edit replaces the pattern: the new one is held, the old one is gone.
    await section.getByRole("button", { name: `Actions for ${pattern}` }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    const edit = page.getByRole("dialog", { name: "Edit origin" });
    await expect(edit.getByRole("textbox", { name: "URL" })).toHaveValue(pattern);
    await edit.getByRole("textbox", { name: "URL" }).fill(edited);
    await edit.getByRole("button", { name: "Save" }).click();
    await expect(edit).toBeHidden();
    await expect(section.getByRole("link", { name: edited })).toBeVisible();
    await expect(section.getByRole("link", { name: pattern })).toBeHidden();

    await section.getByRole("button", { name: `Actions for ${edited}` }).click();
    await page.getByRole("menuitem", { name: "Remove" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Remove origin" }).click();
    await expect(section.getByRole("link", { name: edited })).toBeHidden();
    await expectNoErrorBoundary(page);
  } finally {
    // Whatever the test left behind: a lone origin closes the project's gate
    // to every other spec. Removing an absent pattern is idempotent.
    for (const origin of [pattern, edited]) {
      await withErrorBody(zitadel.api.removeOrigin(zitadel.handle.projectId, { pattern: origin }));
    }
  }
});

test("lists variables set through the API, with a secret held rather than shown", async ({
  page,
  zitadel,
  seed,
}) => {
  await signIn(page, zitadel, await seed.user());
  const name = uniqueName("E2E").replace(/-/g, "_").toUpperCase();
  const secret = `${name}_SECRET`;
  const params = { project_id: zitadel.handle.projectId };

  await withErrorBody(
    zitadel.api.updateVariables(
      { [name]: "plain-value", [secret]: { value: "never-shown", secret: true } },
      params,
    ),
  );
  try {
    await page.goto(`/projects/${zitadel.handle.projectId}`);
    const section = page.getByRole("region", { name: "Variables and Secrets" });
    const plain = section.getByRole("row", { name: new RegExp(`^${name} `) });
    await expect(plain).toContainText("Variable");
    // A plain value without a kind is written for both kinds.
    await expect(plain.getByText("plain-value")).toHaveCount(2);

    const held = section.getByRole("row", { name: new RegExp(`^${secret} `) });
    await expect(held).toContainText("Secret");
    await expect(held).toContainText("Configured");
    // A secret without a kind is primary only, so the preview cell says so.
    await expect(held).toContainText("Not configured");
    await expect(page.getByText("never-shown")).toHaveCount(0);
    await expectNoErrorBoundary(page);
  } finally {
    await withErrorBody(zitadel.api.deleteVariable(name, params));
    await withErrorBody(zitadel.api.deleteVariable(secret, params));
  }
});
