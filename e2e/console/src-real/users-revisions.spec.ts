import { randomUUID } from "node:crypto";

import { expect, test } from "@zitadel/testing/playwright";

import { createSchemaFromSeed, withErrorBody } from "../support/api";
import { expectNoErrorBoundary } from "../support/screens";
import { signIn } from "../support/sign-in";

/**
 * The Users list's revision column and filter against a real instance.
 *
 * The unit specs cover which criteria each choice sends. What only a live
 * backend proves is that the server honours them together: `schema_object_type
 * equals` with `schema equals` one revision returns exactly that revision's
 * users, and with `schema not_equals` the newest returns everyone else.
 */

test("narrows the users to one revision of a schema", async ({ page, zitadel, seed }) => {
  const { projectId } = zitadel.handle;
  const suffix = randomUUID();
  const objectType = `e2e-users-revisions-${suffix}`;
  const older = await createSchemaFromSeed(zitadel, { title: `Staff ${suffix}`, objectType });
  const newer = await createSchemaFromSeed(zitadel, { title: `Staff ${suffix}`, objectType });
  const onOlder = `older-${suffix}@example.com`;
  const onNewer = `newer-${suffix}@example.com`;
  for (const [schema, email] of [
    [older.id, onOlder],
    [newer.id, onNewer],
  ] as const) {
    await withErrorBody(
      zitadel.api.createUser({ schema, attributes: { email } }, { project_id: projectId }),
    );
  }

  await signIn(page, zitadel, await seed.user());
  await page.goto("/users");
  const table = page.getByRole("table");
  // Each row names the revision its user is on.
  await expect(table.getByRole("link", { name: older.id })).toBeVisible();
  await expect(table.getByRole("link", { name: newer.id })).toBeVisible();

  // Add filter lists the properties, then the chosen one's values.
  await page.getByRole("button", { name: "Add filter" }).click();
  await page.getByRole("option", { name: "User schema" }).click();
  await page.getByRole("option", { name: `Staff ${suffix}` }).click();
  await page.getByRole("button", { name: "Add filter" }).click();
  await page.getByRole("option", { name: "Revision", exact: true }).click();
  await page.getByRole("option").and(page.getByTitle(older.id)).click();
  await expect(table.getByRole("link", { name: onOlder })).toBeVisible();
  await expect(table.getByRole("link", { name: onNewer })).toHaveCount(0);

  // Once set, the filter's chip reopens its values.
  await page.getByRole("button", { name: "Filter by revision" }).click();
  await page.getByRole("option").and(page.getByTitle(newer.id)).click();
  await expect(table.getByRole("link", { name: onNewer })).toBeVisible();
  await expect(table.getByRole("link", { name: onOlder })).toHaveCount(0);

  await page.getByRole("button", { name: "Filter by revision" }).click();
  await page.getByRole("option", { name: "Older revisions" }).click();
  await expect(table.getByRole("link", { name: onOlder })).toBeVisible();
  await expect(table.getByRole("link", { name: onNewer })).toHaveCount(0);
  await expectNoErrorBoundary(page);
});
