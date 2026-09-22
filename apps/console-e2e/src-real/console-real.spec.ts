import { expect, test } from "@zitadel/testing/playwright";

import { expectNoErrorBoundary, grantProjectAdmin, signIn } from "./support";

test.describe.configure({ mode: "parallel" });

/**
 * What Settings → Admins says on every accepted submit. Retyped rather than
 * imported: this project does not compile console source, so the constant it
 * mirrors (`apps/console/src/components/add-admin-dialog.tsx`) is out of reach.
 */
const NEUTRAL_MESSAGE =
  "If the user exists in our system, they have been granted access to your project.";

test("shows the bootstrapped project in the list and detail views", async ({
  page,
  zitadel,
  seed,
}) => {
  // The list is the projects this person can act on (`GET /users/me/projects`),
  // so the operator needs a grant on the project before it shows up — being
  // able to sign in to it is not access to it.
  const operator = await seed.user();
  await grantProjectAdmin(zitadel.handle, operator.id);
  await signIn(page, operator);

  // The pill reads the same query, with the session cookie alone.
  await expect(page.getByRole("button", { name: "Switch project" })).not.toHaveText("No projects");

  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();

  // The directory lists name and creation date. The id identifies the project on
  // its detail screen, which the row opens — it is no longer on the list, where
  // the screen used to be a key/value view of the one scoped project.
  const projectLink = page.getByRole("table").getByRole("link").first();
  await expect(projectLink).toBeVisible();
  await projectLink.click();

  await expect(page).toHaveURL(new RegExp(`/projects/${zitadel.handle.projectId}$`));
  await expect(page.getByText(zitadel.handle.projectId, { exact: true })).toBeVisible();
  await expectNoErrorBoundary(page);
});

test("shows a seeded user in the list and detail views", async ({ page, seed }) => {
  const user = await seed.user();
  await signIn(page, user);

  await page.goto("/users");
  await expect(page.getByRole("heading", { name: "Users", exact: true })).toBeVisible();

  const userLink = page.getByRole("link", { name: user.email, exact: true });
  await expect(userLink).toBeVisible();
  await userLink.click();

  await expect(page).toHaveURL(new RegExp(`/users/${user.id}$`));
  await expect(page.getByRole("heading", { name: user.email, exact: true })).toBeVisible();
  await expect(page.getByText(user.id, { exact: true })).toBeVisible();
  await expectNoErrorBoundary(page);
});

test("keeps the project credential out of browser requests and resources", async ({
  page,
  zitadel,
  seed,
}) => {
  // Sign in first (Console ADR 0003): the resource pages sit behind the auth
  // guard, and the login exchange itself must not leak the project secret
  // either — the listener below starts before any navigation under test.
  await signIn(page, await seed.user());

  const inspectedResponses: Array<Promise<string | undefined>> = [];
  page.on("response", (response) => {
    const contentType = response.headers()["content-type"] ?? "";
    const textual =
      contentType.includes("html") ||
      contentType.includes("css") ||
      contentType.includes("javascript") ||
      contentType.includes("json");
    if (!textual) return;

    inspectedResponses.push(
      response
        .text()
        .then((body) => (body.includes(zitadel.handle.projectSecret) ? response.url() : undefined))
        .catch(() => undefined),
    );
  });

  // The Projects screen's own read. It is session-authenticated, so the browser
  // request carries no bearer — and the proxy adding one on the way through
  // must not show up here either.
  const responsePromise = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/users/me/projects",
  );

  await page.goto("/projects");
  const response = await responsePromise;

  expect(response.request().headers().authorization).toBeUndefined();
  expect(response.ok()).toBe(true);
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();

  const leakedResources = (await Promise.all(inspectedResponses)).filter(
    (url): url is string => url !== undefined,
  );
  expect(leakedResources).toEqual([]);
  expect((await page.content()).includes(zitadel.handle.projectSecret)).toBe(false);
});

test("shows the status the API stamped on a seeded user", async ({ page, seed }) => {
  // The Status column reads `metadata.status`, which the API only started
  // returning recently. Asserted against a real instance rather than a stub so
  // the column is proven against the shape the server actually sends.
  const user = await seed.user();
  await signIn(page, user);

  await page.goto("/users");
  const row = page.getByRole("row").filter({ hasText: user.email });
  await expect(row.getByText("active", { exact: true })).toBeVisible();
});

test("embeds the team memberships on the list read rather than degrading", async ({
  page,
  seed,
}) => {
  // `expand: ["teams"]` needs `team_membership.read` on top of `user.read`, and
  // the console falls back to an unexpanded read when it is refused — which is
  // silent by design. Asserted against a real instance because the fallback
  // would otherwise hide a genuinely rejected expansion behind a list that
  // still renders: what a stub cannot tell you is whether the *server* accepts
  // the parameter.
  //
  // The column's contents are not asserted. No endpoint writes a membership
  // (`EnsurePersonalTeam` is a no-op outside the platform project, and the API
  // exposes only `GET /users/{user_id}/teams`), so on this instance every user
  // is on no team and every cell is honestly empty. Add the content assertion
  // with the endpoint that can seed one.
  const user = await seed.user();
  await signIn(page, user);

  const query = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/users/query" && response.ok(),
  );
  await page.goto("/users");
  expect(JSON.parse((await (await query).request().postData()) ?? "{}")).toMatchObject({
    expand: ["teams"],
  });

  // The header is the console's own signal that the expansion was served: it is
  // dropped on a 403, so its presence means no fallback happened.
  await expect(page.getByRole("columnheader", { name: "Team", exact: true })).toBeVisible();
  await expectNoErrorBoundary(page);
});

test("gives a colleague admin access to the project, and takes it away", async ({ page, seed }) => {
  // The whole journey of #769 against a live backend: the grant is created for
  // somebody who already exists, shows up in the list with their resolved
  // identity, and is revoked again. Asserted here rather than only over stubs
  // because both writes and the `expand: ["principal"]` read are server
  // behaviour, and the unit specs prove only what the console does with them.
  const operator = await seed.user();
  const colleague = await seed.user();
  await signIn(page, operator);

  await page.goto("/settings/admins");
  await expect(page.getByRole("heading", { name: "Admins", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Add admin", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add admin" });
  await dialog.getByRole("textbox", { name: "Email address" }).fill(colleague.email);
  await dialog.getByRole("button", { name: "Add admin", exact: true }).click();
  await expect(page.getByText(NEUTRAL_MESSAGE)).toBeVisible();

  // The row is what proves the write landed: it comes back from the list read,
  // not from the form's own state. The message above says the same thing
  // whether or not anything was created, which is the point of it.
  const row = page.getByRole("row").filter({ hasText: colleague.email });
  await expect(row).toBeVisible();
  await expect(row.getByText("Admin", { exact: true })).toBeVisible();

  await row.getByRole("button", { name: `Actions for ${colleague.email}` }).click();
  await page.getByRole("menuitem", { name: "Remove admin" }).click();
  const confirm = page.getByRole("alertdialog");
  await confirm.getByRole("button", { name: "Remove admin", exact: true }).click();

  // Gone from the list, which leaves the instance as this test found it.
  await expect(page.getByRole("row").filter({ hasText: colleague.email })).toHaveCount(0);
  await expectNoErrorBoundary(page);
});

test("answers the same way for an address that belongs to nobody", async ({ page, seed }) => {
  // The neutrality of `POST /grants` by identifier (#1229) as the operator
  // experiences it: an address nobody has registered gets the same sentence as
  // one that worked, and the only honest difference — no row — is a fact about
  // the project, not an answer about the address. Asserted against a real
  // instance because it is the server that decides to say nothing, and a stub
  // would be asserting the stub.
  const operator = await seed.user();
  const unknown = `nobody-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  await signIn(page, operator);

  await page.goto("/settings/admins");
  await page.getByRole("button", { name: "Add admin", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add admin" });
  await dialog.getByRole("textbox", { name: "Email address" }).fill(unknown);

  // The list read the dialog triggers on its way out. Without waiting for it,
  // "no row for this address" would be asserted against the list as it was
  // before the submit, where there was no such row either — an assertion that
  // cannot fail.
  const refreshed = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/grants/query" && response.ok(),
  );
  await dialog.getByRole("button", { name: "Add admin", exact: true }).click();

  await expect(page.getByText(NEUTRAL_MESSAGE)).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await refreshed;
  await expect(page.getByRole("row").filter({ hasText: unknown })).toHaveCount(0);
  await expectNoErrorBoundary(page);
});
