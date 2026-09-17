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
