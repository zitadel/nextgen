import { expect, registerWithPassword, test } from "@zitadel/testing/playwright";

import { withErrorBody } from "../support/api";
import { expectNoErrorBoundary } from "../support/screens";

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

test("a platform operator reaches every management screen without an error", async ({
  page,
  zitadel,
  seed,
}) => {
  const operator = seed.identity();

  await page.goto("/ui/console/");
  await registerWithPassword(page, operator);
  await page.waitForURL((url) => !url.pathname.endsWith("/login"));
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();

  // Admin on the customer project, by email: the operator lives in the
  // platform project, which is where a grant resolves an identifier (#1192).
  // Written with the project's secret from the test process, never the page.
  await withErrorBody(
    zitadel.api.createGrant(
      { user: { identifier: operator.email }, relation: "admin" },
      { project_id: zitadel.handle.projectId },
    ),
  );

  const selected = new RegExp(`[?&]project=${zitadel.handle.projectId}(&|$)`);
  for (const [path, heading] of [
    ["users", "Users"],
    ["teams?status=active", "Teams"],
    ["schemas", "User schemas"],
    ["authentication", "Authentication"],
    ["flow-definitions", "Login flows"],
    ["branding", "Branding"],
  ] as const) {
    await page.goto(`/ui/console/${path}`);
    // Opened without a selection, so the guard picks the one granted project.
    await expect(page).toHaveURL(selected);
    // `.first()`: Branding repeats its title on the settings panel.
    await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
    await expectNoErrorBoundary(page);
  }

  // A refused connection read hides the Identity providers tab instead of
  // erroring, so the walk above cannot see it: the tab itself is the proof
  // that the connection query answered on the cookie.
  await page.goto("/ui/console/authentication?tab=identity-providers");
  await expect(page.getByRole("tab", { name: "Identity providers", selected: true })).toBeVisible();
  await expectNoErrorBoundary(page);

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
  await expect(page.locator("zitadel-login").getByRole("textbox", { name: "Email" })).toBeVisible();

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
  await expect(page).toHaveURL(new RegExp(`/project\\?project=${zitadel.handle.projectId}$`));
  await expectNoErrorBoundary(page);

  const field = page.getByLabel("Project name");
  const renamed = `${await field.inputValue()} (platform)`;
  await field.fill(renamed);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: renamed, exact: true })).toBeVisible();
  await expectNoErrorBoundary(page);
});

/**
 * A platform operator names themselves (#1801, #1802): the platform project's
 * user schema designates an optional `name` for display, Profile is generated
 * from the operator's own schema — read through the self-access
 * `GET /users/me/schema`, since they hold no grant in the platform project —
 * and once saved the account menu shows the name over the email.
 */
test("a platform operator adds their name from the account menu", async ({ page, seed }) => {
  const operator = seed.identity();

  await page.goto("/ui/console/");
  await registerWithPassword(page, operator);
  await page.waitForURL((url) => !url.pathname.endsWith("/login"));

  const account = page.getByRole("button", { name: `Account: ${operator.email}` });
  await account.click();
  await page.getByRole("menuitem", { name: /Add your name/ }).click();

  await expect(page).toHaveURL(/\/settings\/profile/);
  await expect(page.getByLabel("Email", { exact: true })).toBeDisabled();
  const name = page.getByLabel("Name", { exact: true });
  await expect(name).toBeFocused();
  await name.fill("Ada Lovelace");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expectNoErrorBoundary(page);

  // The footer now leads with the name, the email beneath it.
  const named = page.getByRole("button", { name: "Account: Ada Lovelace" });
  await expect(named).toContainText(operator.email);
  await named.click();
  await expect(page.getByRole("menu").getByText("Ada Lovelace")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /Add your name/ })).toHaveCount(0);
});

/**
 * Settings → Account renames the operator's account: the personal team created
 * for them at sign-up (#1890 grants them its rename), shown in the footer.
 */
test("a platform operator renames their account", async ({ page, seed }) => {
  const operator = seed.identity();

  await page.goto("/ui/console/");
  await registerWithPassword(page, operator);
  await page.waitForURL((url) => !url.pathname.endsWith("/login"));
  // The landing redirect must settle first, or it interrupts the next goto.
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();

  await page.goto("/ui/console/settings/account");
  const field = page.getByLabel("Account name");
  await field.fill("Acme Platform");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expectNoErrorBoundary(page);

  await expect(page.getByRole("button", { name: `Account: ${operator.email}` })).toContainText(
    "Acme Platform",
  );
});
