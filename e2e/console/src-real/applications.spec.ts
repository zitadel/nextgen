import { expect, test } from "@zitadel/testing/playwright";

import { registerApplication } from "../support/api";
import { expectNoErrorBoundary } from "../support/screens";
import { signIn } from "../support/sign-in";

/**
 * The application detail against a real instance: the Source badge reads the
 * `declared` the server stores, not a fixture of it.
 */
test("shows a registered application's source", async ({ page, zitadel, seed }) => {
  await signIn(page, zitadel, await seed.user());
  const id = await registerApplication(zitadel, `e2e-shop-${Date.now()}`);

  await page.goto(`/applications/${id}`);

  const overview = page.locator("[data-slot=card]").filter({
    has: page.getByRole("heading", { level: 2, name: "Overview" }),
  });
  await expect(overview.getByText("Registered")).toBeVisible();
  await expectNoErrorBoundary(page);
});
