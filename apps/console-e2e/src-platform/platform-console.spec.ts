import type { Page } from "@playwright/test";
import { expect, registerWithPassword, test } from "@zitadel/testing/playwright";

/**
 * A platform operator in the embedded console (#1300): signed up through the
 * console's own login, so homed in the platform project as a real operator
 * is, and granted admin on the instance's customer project by email. Every
 * request the browser makes runs on the session cookie alone.
 *
 * The customer project is the only one the operator holds a grant on, so the
 * console selects it on its own (`?project=`, #1299) and every screen below
 * reads it rather than the platform project the operator signed in to. What
 * this pins is that each of them answers for the customer project without an
 * error state, and that the project is writable from its settings page.
 */

const password = "Platform-Operator-Passw0rd!";

/** The titles the console's error states render (`components/boundaries.tsx`). */
const ERROR_STATES = [
  /^Request failed \(\d+\)$/,
  /^Not authorized$/,
  /^Console API not authorized$/,
  /^Something went wrong$/,
  /^Not found$/,
];

async function expectNoErrorState(page: Page): Promise<void> {
  for (const title of ERROR_STATES) {
    await expect(page.getByText(title)).toHaveCount(0);
  }
}

test("a platform operator reaches every management screen without an error", async ({
  page,
  zitadel,
  seed,
}) => {
  const operator = seed.identity().email;

  await page.goto("/ui/console/");
  await registerWithPassword(page, { email: operator, password });
  await page.waitForURL((url) => !url.pathname.endsWith("/login"));
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();

  // Admin on the customer project, by email: the operator lives in the
  // platform project, which is where a grant resolves an identifier (#1192).
  // Written with the project's secret from the test process, never the page.
  const response = await fetch(
    `${zitadel.handle.baseUrl}/grants?project_id=${zitadel.handle.projectId}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${zitadel.handle.projectSecret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ user: { identifier: operator }, relation: "admin" }),
    },
  );
  expect(response.ok, await response.text()).toBe(true);

  const selected = new RegExp(`[?&]project=${zitadel.handle.projectId}(&|$)`);
  for (const [path, heading] of [
    ["users", "Users"],
    ["teams?status=active", "Teams"],
    ["schemas", "User schemas"],
    ["flow-definitions", "Login flows"],
    ["branding", "Branding"],
  ] as const) {
    await page.goto(`/ui/console/${path}`);
    // Opened without a selection, so the guard picks the one granted project.
    await expect(page).toHaveURL(selected);
    // `.first()`: Branding repeats its title on the settings panel.
    await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
    await expectNoErrorState(page);
  }

  // The branding preview starts its flow in the selected customer project,
  // not the platform project the operator signed in to. Only here do the two
  // differ, so the request body is what says which one it ran in.
  const flowStart = page.waitForRequest(
    (request) => request.method() === "POST" && new URL(request.url()).pathname.endsWith("/flow"),
  );
  await page.goto("/ui/console/branding");
  expect((await flowStart).postDataJSON()).toMatchObject({
    project_id: zitadel.handle.projectId,
  });
  await expect(
    page.locator("zitadel-login").getByRole("textbox", { name: "Email" }),
  ).toBeVisible();

  // The granted customer project: listed on the overview, where a row opens
  // the project (selects it, lands on Teams); its own page is Project settings.
  await page.goto("/ui/console/projects");
  const projectLink = page.getByRole("table").getByRole("link").first();
  await expect(projectLink).toBeVisible();
  await projectLink.click();
  await expect(page).toHaveURL(new RegExp(`/teams\\?.*project=${zitadel.handle.projectId}`));
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Project settings" })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/project\\?project=${zitadel.handle.projectId}$`),
  );
  await expectNoErrorState(page);

  const field = page.getByLabel("Project name");
  const renamed = `${await field.inputValue()} (platform)`;
  await field.fill(renamed);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: renamed, exact: true })).toBeVisible();
  await expectNoErrorState(page);
});
