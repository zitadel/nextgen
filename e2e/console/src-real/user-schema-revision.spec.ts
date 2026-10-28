import { randomUUID } from "node:crypto";

import { expect, test } from "@zitadel/testing/playwright";

import { createSchemaFromSeed, withErrorBody } from "../support/api";
import { expectNoErrorBoundary } from "../support/screens";
import { signIn } from "../support/sign-in";

/**
 * The user detail screen's schema revision link against a real instance.
 *
 * The unit specs cover what the link renders and where it points, and the
 * router's encoding of the id is client-only. What only a live backend proves
 * is that the dev proxy and the API route accept a `$id` URL id, `%2F` and
 * all, and return that schema. The seeded schema has a plain `sch_*` id, so
 * the test writes its own schema with a `$id` and puts the subject on it.
 */

test("opens a user's URI schema revision from the user detail screen", async ({
  page,
  zitadel,
  seed,
}) => {
  const { projectId } = zitadel.handle;
  const suffix = randomUUID();
  const title = `Revision ${suffix}`;
  const uri = `https://e2e.test/schemas/${suffix}.json`;
  const schema = await createSchemaFromSeed(zitadel, { $id: uri, title });
  expect(schema.id).toBe(uri);
  const email = seed.identity().email;
  await withErrorBody(
    zitadel.api.createUser({ schema: schema.id, attributes: { email } }, { project_id: projectId }),
  );

  const actor = await seed.user();
  await signIn(page, zitadel, actor);
  await page.goto("/users");
  await page.getByRole("link", { name: email }).click();
  await expect(page.getByRole("heading", { name: email })).toBeVisible();

  // The Overview card's only link is the revision box.
  await page.getByRole("tabpanel").getByRole("link").click();

  await expect(page).toHaveURL((url) =>
    url.pathname.endsWith(`/schemas/${encodeURIComponent(schema.id)}`),
  );
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expectNoErrorBoundary(page);
});
