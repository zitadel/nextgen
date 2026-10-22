import { expect, test } from "@zitadel/testing/playwright";

import {
  addPrimaryOrigin,
  createDistinctRelease,
  createRelease,
  deployToPrimary,
} from "../support/api";
import { expectNoErrorBoundary } from "../support/screens";
import { signIn } from "../support/sign-in";

/**
 * The release screens against a real instance.
 *
 * What this covers that the unit specs cannot is the round trip: the release
 * the server builds records each resource's *handle*, the detail reads the
 * revision behind each pointer through the per-kind endpoints, and the
 * deployment the server records is what the card and the directory list. A
 * fixture can only assert the shape the spec author believed in; this asserts
 * the shape the server actually writes.
 *
 * One at a time: the tests share the instance's project, and a deploy in one
 * moves the live deployment another is about to roll back from, which the
 * server's guard refuses, as it should.
 */
test.describe.configure({ mode: "serial" });

test("lists a built release and opens the configuration it pins", async ({
  page,
  zitadel,
  seed,
}) => {
  await signIn(page, zitadel, await seed.user());
  // A release is one per pinned set: when this instance already holds a
  // release pinning the same revisions, the server answers with that one and
  // its message, so the screen is checked against what the server returned.
  const release = await createRelease(zitadel, `e2e release ${Date.now()}`);
  const origin = `https://${Date.now()}.e2e.acme.test`;
  await deployToPrimary(zitadel, release.id, origin);

  // A release is reached from a deployment row.
  await page.goto("/deployments");
  const row = page.getByRole("row").filter({ hasText: release.id }).first();
  await expect(row).toBeVisible();
  // The kind and the status come from the record the server wrote.
  await expect(row.getByText("Primary")).toBeVisible();
  await expect(row.getByText("active")).toBeVisible();
  await row.getByRole("link", { name: release.id }).click();

  await expect(page.getByRole("heading", { name: release.id })).toBeVisible();

  // The server bootstraps one schema and one flow, so the release pins one of
  // each, grouped by kind. `default-login` is a slug on the wire; the row is
  // what makes it a label.
  await expect(page.getByRole("heading", { name: "User schemas" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Login flows" })).toBeVisible();
  const flow = page.getByRole("button", { name: /^Default login / });
  await expect(flow).toBeVisible();

  // Opening a pointer reads the revision it names: the document is the server's
  // own, so this is the regression guard for a pointer resolved at the wrong
  // endpoint or with the wrong id.
  await flow.click();
  await page.getByRole("tab", { name: "YAML" }).click();
  await expect(page.getByText("name: default-login")).toBeVisible();

  // The card under the pointers lists the deployment the server recorded,
  // with the origin it resolved `primary` to.
  await expect(page.getByText("Deployment of this release")).toBeVisible();
  await expect(page.getByRole("link", { name: origin })).toBeVisible();

  await expect(page.getByText(release.message)).toBeVisible();
  await expectNoErrorBoundary(page);
});

test("lists the project's deployments without leaving the shell", async ({
  page,
  zitadel,
  seed,
}) => {
  await signIn(page, zitadel, await seed.user());
  await page.goto("/deployments");

  await expect(page.getByRole("heading", { name: "Deployments" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Release" })).toBeVisible();
  await expectNoErrorBoundary(page);
});

test("deploys a release to the primary origins from the directory", async ({
  page,
  zitadel,
  seed,
}) => {
  await signIn(page, zitadel, await seed.user());
  // Distinct: the drawer leaves out the release the origins already serve,
  // and the pointer-set release above is live by now.
  const release = await createDistinctRelease(zitadel, `e2e deploy ${Date.now()}`);
  const origin = `https://${Date.now()}.deploy.acme.test`;
  await addPrimaryOrigin(zitadel, origin);

  await page.goto("/deployments");
  await page.getByRole("button", { name: "New deployment" }).click();
  const drawer = page.getByRole("dialog", { name: "Deploy release" });
  await expect(drawer).toBeVisible();
  // The card lists what `primary` resolves to on the server: the origin just
  // added is among the project's primary origins.
  await expect(drawer.getByRole("link", { name: origin })).toBeVisible();

  await drawer.getByRole("combobox", { name: "Release" }).click();
  await page.getByRole("option", { name: release.id }).click();
  await drawer.getByLabel("Message").fill("e2e deploy");
  await drawer.getByRole("button", { name: "Deploy release" }).click();

  // The record the server wrote is what the directory lists.
  await expect(page.getByText("Release deployed")).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: release.id }).first();
  await expect(row).toBeVisible();
  await expect(row.getByText("Primary")).toBeVisible();
  await expect(row.getByText("active")).toBeVisible();
  await expectNoErrorBoundary(page);
});

test("rolls the primary origins back to a superseded deployment", async ({
  page,
  zitadel,
  seed,
}) => {
  await signIn(page, zitadel, await seed.user());
  const stamp = Date.now();
  const first = await createDistinctRelease(zitadel, `e2e rollback from ${stamp}`);
  const second = await createDistinctRelease(zitadel, `e2e rollback to ${stamp}`);
  const origin = `https://${stamp}.rollback.acme.test`;
  await deployToPrimary(zitadel, first.id, origin);
  await deployToPrimary(zitadel, second.id, origin);

  await page.goto("/deployments");
  const superseded = page.getByRole("row").filter({ hasText: first.id }).first();
  await expect(superseded.getByText("Superseded")).toBeVisible();
  await superseded.getByRole("button", { name: /^Actions for / }).click();
  await page.getByRole("menuitem", { name: "Rollback" }).click();

  const drawer = page.getByRole("dialog", { name: "Rollback deployment" });
  await expect(drawer).toBeVisible();
  // The live deployment the server reports, and the row's deployment chosen.
  await expect(drawer.getByText(second.id)).toBeVisible();
  await expect(drawer.getByRole("radio", { checked: true })).toBeVisible();
  await drawer.getByLabel("Message").fill("e2e rollback");
  await drawer.getByRole("button", { name: "Rollback deployment" }).click();

  // The rollback is a new deployment of the first release, live on the origin.
  await expect(page.getByText("Deployment rolled back")).toBeVisible();
  const live = page.getByRole("row").filter({ hasText: first.id }).first();
  await expect(live.getByText("active")).toBeVisible();
  await expectNoErrorBoundary(page);
});

test("revokes a release once nothing serves it, and refuses while one does", async ({
  page,
  zitadel,
  seed,
}) => {
  await signIn(page, zitadel, await seed.user());
  const stamp = Date.now();
  const first = await createDistinctRelease(zitadel, `e2e revoke ${stamp}`);
  const second = await createDistinctRelease(zitadel, `e2e revoke keeps ${stamp}`);
  const origin = `https://${stamp}.revoke.acme.test`;
  await deployToPrimary(zitadel, first.id, origin);
  await deployToPrimary(zitadel, second.id, origin);

  // The live release is refused before any request.
  await page.goto(`/releases/${second.id}`);
  await page.getByRole("button", { name: `Actions for ${second.id}` }).click();
  await page.getByRole("menuitem", { name: "Revoke release" }).click();
  const blocked = page.getByRole("alertdialog", { name: "Release cannot be revoked" });
  await expect(blocked).toBeVisible();
  await blocked.getByRole("button", { name: "Close" }).click();

  // The superseded one revokes, and the server's record says so.
  await page.goto(`/releases/${first.id}`);
  await page.getByRole("button", { name: `Actions for ${first.id}` }).click();
  await page.getByRole("menuitem", { name: "Revoke release" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Revoke" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Revoke release" }).click();

  await expect(page.getByText("Release revoked")).toBeVisible();
  await expect(page.getByText("Revoked")).toBeVisible();
  await expect(page.getByRole("button", { name: `Actions for ${first.id}` })).toHaveCount(0);
  await expectNoErrorBoundary(page);
});

test("redeploys a release from its row", async ({ page, zitadel, seed }) => {
  await signIn(page, zitadel, await seed.user());
  const release = await createDistinctRelease(zitadel, `e2e redeploy ${Date.now()}`);
  const origin = `https://${Date.now()}.redeploy.acme.test`;
  await deployToPrimary(zitadel, release.id, origin);

  await page.goto("/deployments");
  const row = page.getByRole("row").filter({ hasText: release.id }).first();
  await row.getByRole("button", { name: /^Actions for / }).click();
  await page.getByRole("menuitem", { name: "Redeploy" }).click();

  const drawer = page.getByRole("dialog", { name: "Redeploy release" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("combobox", { name: "Release" })).toHaveText(release.id);
  await expect(drawer.getByRole("link", { name: origin })).toBeVisible();
  await drawer.getByRole("button", { name: "Redeploy release" }).click();

  // The origins serve the release already, so the server answers with the
  // deployment that is live, and the row stays.
  await expect(page.getByText("Release redeployed")).toBeVisible();
  await expect(row.getByText("active")).toBeVisible();
  await expectNoErrorBoundary(page);
});
