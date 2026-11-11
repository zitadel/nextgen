import { expect, registerWithPassword, test } from "@zitadel/testing/playwright";

import { claimProject } from "../support/api";
import { expectNoErrorBoundary } from "../support/screens";

/**
 * A platform operator in the embedded console (#1300): signed up through the
 * console's own login, so homed in the platform project as a real operator
 * is, and admin of the instance's customer project by claiming it. Every
 * request the browser makes runs on the session cookie alone.
 *
 * The customer project is the only one the operator has access to, so the
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
  // The account menu, which both the home and a project's screens draw.
  await expect(page.getByRole("button", { name: /^Account:/ })).toBeVisible();

  // Admin on the customer project by claiming it: an unclaimed project
  // cannot grant a platform user (ADR 054 §4 amendment). The claim starts with
  // the project's secret from the test process, never the page.
  await claimProject(zitadel, page);

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

  // The platform project the console signs in to is the root, not a project
  // (D41): the server marks it, Projects never lists it, and this operator,
  // who holds no grant on it, finds none of its pages in Settings.
  const runtime = (await (await page.request.get("/console/runtime.json")).json()) as {
    console_project_id?: string;
    platform_project_id?: string;
  };
  expect(runtime.platform_project_id).toBeTruthy();
  expect(runtime.platform_project_id).toBe(runtime.console_project_id);

  // The granted customer project: listed on Projects, where a row opens the
  // project (selects it, lands on its Overview, D35); its Settings open on
  // their first page, General (D40).
  await page.goto("/ui/console/projects");
  const projectLink = page.getByRole("table").getByRole("link").first();
  await expect(projectLink).toBeVisible();
  // Bootstrap names the platform project "Platform" (internal/bootstrap/platform).
  await expect(page.getByRole("table").getByRole("link", { name: "Platform" })).toHaveCount(0);
  await expect(
    page.getByRole("navigation", { name: "Account" }).getByRole("link", { name: "Settings" }),
  ).toHaveCount(0);
  await projectLink.click();
  await expect(page).toHaveURL(new RegExp(`/console/?\\?project=${zitadel.handle.projectId}$`));
  await expect(page.getByRole("region", { name: "Production" })).toBeVisible();
  await expectNoErrorBoundary(page);
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Settings" })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/project/general\\?project=${zitadel.handle.projectId}$`),
  );
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
 * user schema designates an optional `name` for display, the profile is generated
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
  // The person heading the menu opens their profile.
  await page.getByRole("menuitem", { name: operator.email }).click();

  await expect(page).toHaveURL(/\/account(\?|$)/);
  await expect(page.getByLabel("Email", { exact: true })).toBeDisabled();
  const name = page.getByLabel("Name", { exact: true });
  await name.fill("Ada Lovelace");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expectNoErrorBoundary(page);

  // The footer now leads with the name, the email beneath it.
  const named = page.getByRole("button", { name: "Account: Ada Lovelace" });
  await expect(named).toContainText(operator.email);
  await named.click();
  await expect(page.getByRole("menuitem", { name: /^Ada Lovelace/ })).toContainText(operator.email);
});
