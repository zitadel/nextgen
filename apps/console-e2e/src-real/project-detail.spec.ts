import { expect, test } from "@zitadel/testing/playwright";

import { expectNoErrorBoundary, signIn } from "./support";

/**
 * The project rename, against a real instance.
 *
 * The unit spec drives it over a stubbed `PATCH`, which proves the form but not
 * the round trip. This proves the write reaches the server and survives a
 * reload.
 *
 * Deliberately serial and self-restoring: a standalone deployment has exactly
 * one project (`POST /projects/query` is scope-pinned, console ADR 0004), so
 * this renames the same record every other test reads. It puts the original name
 * back before finishing.
 */

test.describe.configure({ mode: "serial" });

test("renames the project and the change survives a reload", async ({ page, zitadel, seed }) => {
  await signIn(page, await seed.user());

  await page.goto(`/projects/${zitadel.handle.projectId}`);
  const heading = page.getByRole("heading").first();
  const original = (await heading.textContent())?.trim() ?? "";
  expect(original).not.toBe("");

  const renamed = `${original}-renamed`;
  const field = page.getByLabel("Project name");
  const save = page.getByRole("button", { name: "Save", exact: true });

  await expect(save).toBeDisabled();
  await field.fill(renamed);
  await save.click();

  // The save re-runs the loader, so the heading follows the record rather than
  // the field's draft — that is what shows the PATCH landed.
  await expect(page.getByRole("heading", { name: renamed, exact: true })).toBeVisible();
  await expect(save).toBeDisabled();

  await page.reload();
  await expect(page.getByRole("heading", { name: renamed, exact: true })).toBeVisible();
  await expect(page.getByLabel("Project name")).toHaveValue(renamed);
  await expectNoErrorBoundary(page);

  // Leave the instance as it was found: every other spec reads this project.
  await page.getByLabel("Project name").fill(original);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: original, exact: true })).toBeVisible();
});
