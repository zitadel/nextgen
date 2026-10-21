import { randomUUID } from "node:crypto";

import { expect, test } from "@zitadel/testing/playwright";

import { withErrorBody } from "../support/api";
import { expectNoErrorBoundary } from "../support/screens";
import { signIn } from "../support/sign-in";

/**
 * Saving a user's attributes from the user detail screen against a real
 * instance.
 *
 * The unit specs cover which attributes the form sends. What only a live
 * backend proves is that the session cookie alone authorizes
 * `PATCH /users/{user_id}` through the dev proxy, that the schema accepts a
 * changed string and a boolean turned on with a switch, and that the API reads
 * both back, the boolean as JSON `true` rather than the string. The seeded
 * schema has no boolean property, so the test writes its own schema with one
 * and puts the subject on it.
 */

test("saves changed attributes of a user", async ({ page, zitadel, seed }) => {
  const { projectId, schemaId: seededSchemaId } = zitadel.handle;
  const { schema: template } = await zitadel.api.getSchemaById(seededSchemaId);
  const suffix = randomUUID();
  // Its own `objectType`: sharing the seeded one would make this schema the
  // newest revision of it, the one other specs' Add user drawers pick from.
  const schema = await withErrorBody(
    zitadel.api.createSchema(
      {
        ...template,
        objectType: `e2e-attributes-${suffix}`,
        properties: {
          ...template.properties,
          newsletter: { type: "boolean", title: "Newsletter" },
        },
      },
      { project_id: projectId },
    ),
  );
  const subjectEmail = seed.identity().email;
  const subject = await withErrorBody(
    zitadel.api.createUser(
      { schema: schema.id, attributes: { email: subjectEmail } },
      { project_id: projectId },
    ),
  );
  const email = seed.identity().email;

  const actor = await seed.user();
  await signIn(page, zitadel, actor);
  await page.goto("/users");
  await page.getByRole("link", { name: subjectEmail }).click();
  await expect(page.getByRole("heading", { name: subjectEmail })).toBeVisible();

  const panel = page.getByRole("tabpanel");
  const save = panel.getByRole("button", { name: "Save", exact: true });
  await expect(save).toBeDisabled();
  await panel.getByLabel("Email").fill(email);
  await panel.getByRole("switch", { name: "Newsletter" }).click();
  await save.click();

  // The save re-runs the loader, so the heading follows the stored email. A
  // refusal shows the server's message instead, read out so a failure names it.
  const alert = panel.getByRole("alert");
  await expect(page.getByRole("heading", { name: email }).or(alert)).toBeVisible();
  expect(await alert.allTextContents()).toEqual([]);

  const stored = (await zitadel.api.getUserByID(subject.id)) as {
    attributes?: Record<string, unknown>;
  };
  expect(stored.attributes?.email).toBe(email);
  expect(stored.attributes?.newsletter).toBe(true);
  await expectNoErrorBoundary(page);
});
