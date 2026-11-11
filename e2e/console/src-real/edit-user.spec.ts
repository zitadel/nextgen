import { expect, test } from "@zitadel/testing/playwright";

import { createSchemaFromSeed, withErrorBody } from "../support/api";
import { expectNoErrorBoundary } from "../support/screens";
import { signIn } from "../support/sign-in";

/**
 * The user detail screen's Save against a real instance.
 *
 * The unit specs cover which attributes a save sends. What only a live backend
 * proves is that `PATCH /users/{user_id}` takes the session cookie and its CSRF
 * token, that the schema accepts a boolean turned on with a switch, and that
 * the changes are stored rather than only shown, the boolean as JSON `true`
 * rather than the string. The seeded schema has no boolean property, so the
 * test writes its own schema with one and puts the subject on it.
 */

test("saves a user's attributes and keeps them across a reload", async ({
  page,
  zitadel,
  seed,
}) => {
  const { projectId } = zitadel.handle;
  const schema = await createSchemaFromSeed(zitadel, (template) => ({
    properties: {
      ...template.properties,
      newsletter: { type: "boolean", title: "Newsletter" },
    },
  }));
  const email = seed.identity().email;
  const subject = await withErrorBody(
    zitadel.api.createUser({ schema: schema.id, attributes: { email } }, { project_id: projectId }),
  );

  const actor = await seed.user();
  await signIn(page, zitadel, actor);
  await page.goto("/users");
  await page.getByRole("link", { name: email }).click();
  await expect(page.getByRole("heading", { name: email })).toBeVisible();

  const save = page.getByRole("button", { name: "Save" });
  await expect(save).toBeDisabled();
  const renamed = `renamed-${email}`;
  await page.getByLabel("Email").fill(renamed);
  await page.getByRole("switch", { name: "Newsletter" }).click();
  await save.click();

  // The heading is the server-resolved identifier, so it changes only once the
  // loader reads the stored user back.
  await expect(page.getByRole("heading", { name: renamed })).toBeVisible();
  await expect(save).toBeDisabled();
  const stored = (await zitadel.api.getUserByID(subject.id)) as {
    attributes?: Record<string, unknown>;
  };
  expect(stored.attributes?.newsletter).toBe(true);
  await page.reload();
  await expect(page.getByLabel("Email")).toHaveValue(renamed);
  await expectNoErrorBoundary(page);
});
