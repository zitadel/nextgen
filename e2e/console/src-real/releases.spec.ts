import { expect, test } from "@zitadel/testing/playwright";

import { addPrimaryOrigin, createRelease, deployToPrimary } from "../support/api";
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
 */

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
  const release = await createRelease(zitadel, `e2e deploy ${Date.now()}`);
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
