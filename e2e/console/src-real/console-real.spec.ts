import { expect, test } from "@zitadel/testing/playwright";

import { ERROR_BOUNDARY_TITLE, NEUTRAL_MESSAGE } from "../support/copy";
import { expectNoErrorBoundary, openAddTeam, uniqueName } from "../support/screens";
import { completeLogin, signIn } from "../support/sign-in";

test("shows the bootstrapped project in the list and detail views", async ({
  page,
  zitadel,
  seed,
}) => {
  // The list is the projects this person can act on (`GET /users/me/projects`),
  // so the operator needs a grant on the project before it shows up — being
  // able to sign in to it is not access to it.
  const operator = await seed.user();
  await signIn(page, zitadel, operator);

  // The pill reads the same query, with the session cookie alone.
  await expect(page.getByRole("button", { name: "Switch project" })).not.toHaveText("No projects");

  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();

  // The directory lists name and creation date. A row opens the project —
  // selects it and lands on its first screen — and the project's own page, where
  // the id is, is `Project settings` in the sidebar that selection fills.
  const projectLink = page.getByRole("table").getByRole("link").first();
  await expect(projectLink).toBeVisible();
  await projectLink.click();

  await expect(page).toHaveURL(new RegExp(`/users\\?.*project=${zitadel.handle.projectId}`));
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Project settings" })
    .click();
  await expect(page).toHaveURL(new RegExp(`/project\\?project=${zitadel.handle.projectId}$`));
  await expect(page.getByText(zitadel.handle.projectId, { exact: true })).toBeVisible();
  await expectNoErrorBoundary(page);
});

test("searches the projects on the server", async ({ page, zitadel, seed }) => {
  // The unit specs stub the read, so only a live server proves the search
  // reaches it: a query parameter the server does not know is dropped without
  // an error, and the whole list would come back instead.
  await signIn(page, zitadel, await seed.user());
  const { name } = await zitadel.api.getProject(zitadel.handle.projectId);
  // A prefix, in another case: the rename spec appends to the name while it
  // runs, and the match ignores case.
  const needle = name.slice(0, Math.ceil(name.length / 2)).toUpperCase();

  const searched = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname === "/api/users/me/projects" && url.searchParams.has("name_contains");
  });
  await page.goto(`/projects?q=${encodeURIComponent(needle)}`);
  expect(new URL((await searched).url()).searchParams.get("name_contains")).toBe(needle);
  await expect(page.getByRole("table").getByRole("link")).toHaveAttribute(
    "href",
    new RegExp(`project=${zitadel.handle.projectId}`),
  );

  const nothing = `no-such-project-${crypto.randomUUID()}`;
  await page.goto(`/projects?q=${nothing}`);
  await expect(page.getByText(`No projects match “${nothing}”.`)).toBeVisible();
  await expectNoErrorBoundary(page);
});

test("shows a seeded user in the list and detail views", async ({ page, zitadel, seed }) => {
  const user = await seed.user();
  await signIn(page, zitadel, user);

  await page.goto("/users");
  await expect(page.getByRole("heading", { name: "Users", exact: true })).toBeVisible();

  const userLink = page.getByRole("link", { name: user.email, exact: true });
  await expect(userLink).toBeVisible();
  await userLink.click();

  // The selected project rides along on every link (`?project=`).
  await expect(page).toHaveURL(new RegExp(`/users/${user.id}\\?project=`));
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
  await signIn(page, zitadel, await seed.user());

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

test("shows the status the API stamped on a seeded user", async ({ page, zitadel, seed }) => {
  // The Status column reads `metadata.status`, which the API only started
  // returning recently. Asserted against a real instance rather than a stub so
  // the column is proven against the shape the server actually sends.
  const user = await seed.user();
  await signIn(page, zitadel, user);

  await page.goto("/users");
  const row = page.getByRole("row").filter({ hasText: user.email });
  await expect(row.getByText("active", { exact: true })).toBeVisible();
});

test("gives a colleague admin access to the project, and takes it away", async ({
  browser,
  baseURL,
  page,
  zitadel,
  seed,
}) => {
  // The whole journey of #769 against a live backend: the grant is created for
  // somebody who already exists, shows up in the list with their resolved
  // identity, and is revoked again. Asserted here rather than only over stubs
  // because both writes and the `expand: ["principal"]` read are server
  // behaviour, and the unit specs prove only what the console does with them.
  //
  // The list alone would pass with a grant that opens nothing, so the
  // colleague's own session is what decides: refused before the grant, able to
  // change the project with it, refused again once it is revoked. The journey's
  // claim suite proves the hand-off with the platform project bootstrapped;
  // this lane runs without it, where "Add admin" resolves the colleague in the
  // project the console signs into (#1295).
  //
  // Admins live on the project's page (#1238). The operator needs access to the
  // project to open it — a seeded user can sign in but holds no grant.
  const operator = await seed.user();
  const colleague = await seed.user();
  const teamsUrl = `/teams?project=${zitadel.handle.projectId}`;

  // The colleague signs in without the grant `signIn` writes, in a context of
  // their own: one cookie jar holds one session.
  const colleagueContext = await browser.newContext({ baseURL });
  try {
    const colleaguePage = await colleagueContext.newPage();
    await completeLogin(colleaguePage, colleague);
    await colleaguePage.goto(teamsUrl);
    await expect(colleaguePage.getByText(ERROR_BOUNDARY_TITLE)).toBeVisible();

    await signIn(page, zitadel, operator);
    await page.goto(`/projects/${zitadel.handle.projectId}`);
    await expect(page.getByRole("region", { name: "Admins" })).toBeVisible();

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

    // With the grant the colleague's session can write to the project, not only
    // read it: the team comes back from the list read after `POST /teams`.
    await colleaguePage.reload();
    await expect(colleaguePage.getByRole("heading", { name: "Teams", exact: true })).toBeVisible();
    const team = uniqueName("granted");
    const addTeam = await openAddTeam(colleaguePage);
    await addTeam.name.fill(team);
    await addTeam.submit.click();
    await expect(addTeam.drawer).toBeHidden();
    await expect(colleaguePage.getByRole("link", { name: team, exact: true })).toBeVisible();
    await expectNoErrorBoundary(colleaguePage);

    await row.getByRole("button", { name: `Actions for ${colleague.email}` }).click();
    await page.getByRole("menuitem", { name: "Remove admin" }).click();
    const confirm = page.getByRole("alertdialog");
    await confirm.getByRole("button", { name: "Remove admin", exact: true }).click();

    // Gone from the list, which leaves the instance as this test found it.
    await expect(page.getByRole("row").filter({ hasText: colleague.email })).toHaveCount(0);
    await expectNoErrorBoundary(page);

    // And the colleague loses the project with the grant: the screen they just
    // wrote from is refused on its next load.
    await colleaguePage.reload();
    await expect(colleaguePage.getByText(ERROR_BOUNDARY_TITLE)).toBeVisible();
  } finally {
    await colleagueContext.close();
  }
});

test("answers the same way for an address that belongs to nobody", async ({
  page,
  zitadel,
  seed,
}) => {
  // The neutrality of `POST /grants` by identifier (#1229) as the operator
  // experiences it: an address nobody has registered gets the same sentence as
  // one that worked, and the only honest difference — no row — is a fact about
  // the project, not an answer about the address. Asserted against a real
  // instance because it is the server that decides to say nothing, and a stub
  // would be asserting the stub.
  const operator = await seed.user();
  const unknown = seed.identity().email;
  await signIn(page, zitadel, operator);

  await page.goto(`/projects/${zitadel.handle.projectId}`);
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
