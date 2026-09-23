import { expect, test } from "@zitadel/testing/playwright";

import { expectNoErrorBoundary, signIn } from "./support";

/**
 * The branding screen against a real instance.
 *
 * Read-only: this slice shows the revision in use and publishes nothing, so
 * the instance is left as it was found. What it covers that a unit spec
 * cannot is the preview — it mounts the real `<zitadel-login>`, which starts
 * a real flow and renders the step this project actually serves. A mocked
 * step would prove only that the fixture matches itself, which is the
 * failure mode the mock exists to avoid.
 */

test("previews the project's own login beside the settings", async ({ page, seed }) => {
  await signIn(page, await seed.user());

  await page.goto("/branding");

  // Level 1: the settings panel is titled "Branding" too, per the design.
  await expect(page.getByRole("heading", { name: "Branding", level: 1 })).toBeVisible();

  // Inside the widget's shadow root: Playwright pierces it, and reaching the
  // field proves the flow started and the step rendered rather than the
  // element merely being in the DOM.
  const preview = page.locator("zitadel-login");
  await expect(preview.getByRole("textbox", { name: "Email" })).toBeVisible();

  await expectNoErrorBoundary(page);
});

test("is reached from the sidebar, nested under the flows it brands", async ({ page, seed }) => {
  await signIn(page, await seed.user());

  await page.goto("/projects");

  // Branding is a sub-row of Login flows, as the design nests it: it is how
  // those flows render rather than a destination of its own.
  const nav = page.getByRole("navigation", { name: "Primary" });
  const flows = nav
    .locator('[data-slot="sidebar-menu-item"]')
    .filter({ has: page.getByRole("link", { name: "Login flows" }) });
  const branding = flows.locator('[data-slot="sidebar-menu-sub"]').getByRole("link", {
    name: "Branding",
  });
  await expect(branding).toBeVisible();
  await branding.click();

  await expect(page).toHaveURL(/\/branding$/);

  // The selector lists the project's own flows, so it comes from the instance
  // rather than a fixed set. A real instance is what proves the label is the
  // one the flow list shows for the same definition.
  await expect(page.getByLabel("Previewed flow")).toContainText("Flow: Default login");

  await expectNoErrorBoundary(page);
});

test("shows the branding in use without a control to change it", async ({ page, seed }) => {
  await signIn(page, await seed.user());

  await page.goto("/branding");
  await expect(page.locator("zitadel-login").getByRole("textbox", { name: "Email" })).toBeVisible();

  // The values are changed in the project configuration. The panel is a
  // description list, and the only textbox on the page is the preview's own.
  const panel = page.getByRole("region", { name: "Branding" });
  await expect(panel.getByText("Corner radius")).toBeVisible();
  await expect(panel.getByRole("textbox")).toHaveCount(0);
  await expect(panel.getByRole("combobox")).toHaveCount(0);
  // A fresh instance has no revision, so the rows read the maintained defaults.
  await expect(panel.getByText("Corner radius").locator("..")).toContainText("Medium");
  await expect(panel.getByText("Primary", { exact: true }).first().locator("..")).toContainText(
    "#",
  );

  await expectNoErrorBoundary(page);
});
