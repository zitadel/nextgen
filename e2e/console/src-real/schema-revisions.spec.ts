import { randomUUID } from "node:crypto";

import { expect, test } from "@zitadel/testing/playwright";

import { withErrorBody } from "../support/api";
import { expectNoErrorBoundary } from "../support/screens";
import { signIn } from "../support/sign-in";

/**
 * The schema detail screen's revision picker against a real instance.
 *
 * The unit specs cover what the picker lists and where a pick navigates. What
 * only a live backend proves is the history read itself: that `GET /schemas`
 * filtered by `object_type` with `revisions=all` returns both revisions of a
 * schema, newest first, and that each opens by its own id. The seeded schema
 * has one revision, so the test mints two of its own type.
 */

test("opens another revision of a schema from its detail screen", async ({
  page,
  zitadel,
  seed,
}) => {
  const { projectId, schemaId: seededSchemaId } = zitadel.handle;
  const { schema: template } = await zitadel.api.getSchemaById(seededSchemaId);
  const suffix = randomUUID();
  // Its own `objectType`: a revision of the seeded one would become the newest
  // revision other specs' Add user drawers pick from.
  const objectType = `e2e-revisions-${suffix}`;
  const revise = (title: string) =>
    withErrorBody(
      zitadel.api.createSchema({ ...template, title, objectType }, { project_id: projectId }),
    );
  const first = await revise(`Revisions ${suffix} first`);
  const second = await revise(`Revisions ${suffix} second`);

  const actor = await seed.user();
  await signIn(page, zitadel, actor);
  await page.goto(`/schemas/${encodeURIComponent(first.id)}`);
  await expect(page.getByRole("heading", { name: `Revisions ${suffix} first` })).toBeVisible();

  const picker = page.getByRole("combobox", { name: "Schema revision" });
  await expect(picker).toContainText(first.id);
  await expect(picker).not.toContainText("latest");
  await expect(page.getByText("Not the newest revision", { exact: false })).toBeVisible();

  await picker.click();
  const options = page.getByRole("listbox").getByRole("option");
  await expect(options).toHaveCount(2);
  await expect(options.first()).toContainText(second.id);
  await expect(options.first()).toContainText("latest");
  await options.first().click();

  await expect(page).toHaveURL((url) =>
    url.pathname.endsWith(`/schemas/${encodeURIComponent(second.id)}`),
  );
  await expect(page.getByRole("heading", { name: `Revisions ${suffix} second` })).toBeVisible();
  await expect(picker).toContainText("latest");
  await expect(page.getByText("Not the newest revision", { exact: false })).toHaveCount(0);
  await expectNoErrorBoundary(page);
});
