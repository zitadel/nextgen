import { expect, test } from "@zitadel/testing/playwright";

import { expectNoErrorBoundary, signIn } from "./support";

/**
 * The branding screen against a real instance.
 *
 * Read-only: this slice publishes nothing, so the instance is left as it was
 * found. What it covers that a unit spec cannot is the preview — it mounts the
 * real `<zitadel-login>`, which starts a real flow and renders the step this
 * project actually serves. A mocked step would prove only that the fixture
 * matches itself, which is the failure mode the mock exists to avoid.
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

test("warns on a palette that cannot be read, as it is typed", async ({ page, seed }) => {
  await signIn(page, await seed.user());

  await page.goto("/branding");
  await expect(page.locator("zitadel-login").getByRole("textbox", { name: "Email" })).toBeVisible();

  // The pair the branding design flags: #FAFAFA on #EB3614 measures 3.97:1,
  // under the 4.5:1 a button label needs.
  // Named by side: the app shell's own nav landmark is already called
  // "Primary", and both palettes carry a row of that name.
  await page.getByLabel("Primary (dark mode)", { exact: true }).fill("#EB3614");
  await page.getByLabel("On primary (dark mode)", { exact: true }).fill("#FAFAFA");

  await expect(page.getByText("1 issue")).toBeVisible();

  // The draft publishes only its dark side, so that is the side the widget
  // resolves whatever the viewer prefers. Asserted rather than assumed: the
  // colour check below is only meaningful against the side being painted.
  await expect(page.locator("zitadel-login")).toHaveAttribute("data-theme", "dark");

  // The draft reaches the widget, not just the panel: the preview's primary
  // button takes the colour being typed.
  const button = page.locator("zitadel-login").locator("zl-button").first();
  await expect(button.locator(".zr-btn--primary")).toHaveCSS(
    "background-color",
    "rgb(235, 54, 20)",
  );

  await expectNoErrorBoundary(page);
});

test("says what a failing pair measures and which rule it misses", async ({ page, seed }) => {
  await signIn(page, await seed.user());

  await page.goto("/branding");
  await page.getByLabel("Primary (dark mode)", { exact: true }).fill("#EB3614");
  await page.getByLabel("On primary (dark mode)", { exact: true }).fill("#FAFAFA");

  // The row has space for a glyph, so the measurement sits behind it. Reaching
  // it by role proves it is operable rather than a title a pointer alone finds.
  // Both rows of the pair carry one; either opens the same detail.
  const markers = page.getByRole("button", { name: /Primary \/ On primary/ });
  await expect(markers).toHaveCount(2);
  await markers.first().click();

  await expect(page.getByText("Primary / On primary", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/3.97:1 .* fails AA for normal text \(4.5:1 required\)/),
  ).toBeVisible();

  await expectNoErrorBoundary(page);
});

test("leaves the published revision alone", async ({ page, seed }) => {
  await signIn(page, await seed.user());

  await page.goto("/branding");
  await page.getByLabel("Primary (dark mode)", { exact: true }).fill("#123456");

  // Nothing in this slice publishes, so a reload comes back to what the
  // project actually serves rather than to the edit.
  await page.reload();
  await expect(page.getByLabel("Primary (dark mode)", { exact: true })).not.toHaveValue("#123456");

  await expectNoErrorBoundary(page);
});
