import { expect, test } from "@zitadel/testing/playwright";

import { expectNoErrorBoundary, signIn } from "./support";

/**
 * The login-flow screens against a real instance.
 *
 * Read-only, so this leaves the instance exactly as it found it. What it covers
 * that the unit specs cannot is the *shape of the embed*: `expand=user_schema`
 * returns the same `{ id, schema, metadata }` envelope `GET /schemas/{id}`
 * does, and the row has to read the display name one level inside it. A fixture
 * is only ever as right as the assumption that wrote it — this one was wrong
 * first, and the row silently fell back to printing the raw `sch_…` id under a
 * heading that says `USER SCHEMA`.
 */

test("lists the seeded flow with a resolved schema name", async ({ page, seed }) => {
  await signIn(page, await seed.user());

  await page.goto("/flow-definitions");

  // The instance is bootstrapped with the default login flow. `default-login`
  // is a slug on the wire; the row is the only thing that makes it a label.
  await expect(page.getByRole("link", { name: "Default login" })).toBeVisible();
  await expect(page.getByText("Login + Register")).toBeVisible();

  // The regression guard: a raw id here means the embed was read at the wrong
  // depth, which looks like working software until you know what it should say.
  const schemaValue = page.getByText("User schema", { exact: true }).first().locator("+ *");
  await expect(schemaValue).not.toHaveText(/^sch_/);
  await expect(schemaValue).not.toHaveText("");

  await expectNoErrorBoundary(page);
});

test("opens a flow and shows its steps and definition", async ({ page, seed }) => {
  await signIn(page, await seed.user());

  await page.goto("/flow-definitions");
  await page.getByRole("link", { name: "Default login" }).click();

  await expect(page.getByRole("heading", { name: "Default login" })).toBeVisible();

  // The steps table reads the definition the server stored, so these row names
  // are the real default flow's, not a fixture's.
  await expect(page.getByRole("cell", { name: "identifier", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "password", exact: true })).toBeVisible();

  // The document panel is the point of the screen: flows are applied through
  // the CLI, so the screen's job is to show what an operator would edit.
  await expect(page.getByRole("tab", { name: "JSON" })).toBeVisible();
  await page.getByRole("tab", { name: "YAML" }).click();
  await expect(page.getByText("name: default-login")).toBeVisible();

  await expectNoErrorBoundary(page);
});
