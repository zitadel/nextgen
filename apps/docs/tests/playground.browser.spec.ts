import { type BrowserContext, expect, type Page, test } from "@playwright/test";

/**
 * The API playground sends with the reader's session only as the account the
 * page shows (components/session-auth.tsx). A context route answers every
 * session call and write, so these tests write nothing, against the local
 * build or a deployment.
 */

interface Reader {
  user_id: string;
  display: string;
}

const ada: Reader = { user_id: "usr_docs_ada", display: "Ada from the docs tests" };
const grace: Reader = { user_id: "usr_docs_grace", display: "Grace from the docs tests" };

/**
 * Answers the session reads as `reader()` says, and records each write's CSRF
 * header. Without `csrf`, the token lookup never answers.
 */
async function stubSession(
  context: BrowserContext,
  baseURL: string,
  reader: () => Reader,
  csrf = true,
): Promise<(string | undefined)[]> {
  const origin = new URL(baseURL).origin;
  const writes: (string | undefined)[] = [];
  await context.route(
    (url) =>
      url.origin === origin &&
      ["/api/v1/sessions/me", "/api/v1/sessions/me/csrf", "/api/v1/teams"].includes(url.pathname),
    async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/api/v1/sessions/me") {
        await route.fulfill({ json: { user: reader() } });
      } else if (path === "/api/v1/sessions/me/csrf") {
        if (csrf) await route.fulfill({ json: { csrf_token: `csrf-${reader().user_id}` } });
      } else {
        writes.push(request.headers()["x-zitadel-csrf"]);
        await route.fulfill({ status: 201, json: { id: "team_docs_test", name: "Docs test" } });
      }
    },
  );
  return writes;
}

/** Opens Create team's playground, once it shows the session's account. */
async function openPlayground(page: Page, name: string) {
  await page.goto("/docs/reference/api/teams/createTeam");
  await page.getByRole("button", { name: "Try in Playground" }).click();
  const playground = page.getByRole("dialog", { name: "Create team" });
  const note = playground.getByText("Sent with your session, signed in as", { exact: false });
  await expect(note).toContainText(name);
  await playground.getByRole("textbox", { name: "name", exact: true }).fill("Docs test");
  return { playground, note, send: playground.getByRole("button", { name: /^Send/ }) };
}

test("the playground sends nothing as another account than the one it shows", async ({
  page,
  context,
  baseURL,
}) => {
  let reader = ada;
  const writes = await stubSession(context, baseURL!, () => reader);
  const { playground, note, send } = await openPlayground(page, ada.display);

  // Another tab signs out and in as someone else.
  reader = grace;
  await send.click();
  await expect(
    playground.getByText("Not sent: your session changed", { exact: false }),
  ).toBeVisible();
  await expect(note).toContainText(grace.display);
  expect(writes).toEqual([]);

  // Sent again, it goes as the account the page now shows, with its token.
  await send.click();
  await expect.poll(() => writes).toEqual([`csrf-${grace.user_id}`]);
});

test("a token lookup that never answers ends with the playground's timeout", async ({
  page,
  context,
  baseURL,
}) => {
  // Fumadocs gives a request 10 seconds.
  test.slow();
  const writes = await stubSession(context, baseURL!, () => ada, false);
  const { playground, send } = await openPlayground(page, ada.display);

  await send.click();
  await expect(playground.getByText("TimeoutError", { exact: false })).toBeVisible({
    timeout: 20_000,
  });
  expect(writes).toEqual([]);
});

test("optional project scope starts unset and can be set and unset explicitly", async ({
  page,
  context,
  baseURL,
}) => {
  await stubSession(context, baseURL!, () => ada);
  const origin = new URL(baseURL!).origin;
  const projects: (string | null)[] = [];
  await context.route(
    (url) => url.origin === origin && url.pathname === "/api/v1/users/query",
    async (route) => {
      projects.push(new URL(route.request().url()).searchParams.get("project_id"));
      await route.fulfill({ json: { users: [] } });
    },
  );

  await page.goto("/docs/reference/api/users/queryUsers");
  await page.getByRole("button", { name: "Try in Playground" }).click();
  const playground = page.getByRole("dialog", { name: "Query users" });
  await expect(playground.getByText("Sent with your session", { exact: false })).toContainText(
    ada.display,
  );
  const project = playground.getByRole("textbox", { name: "project_id", exact: true });
  const sample = playground.locator("pre").filter({ hasText: "@zitadel/api/" });
  const send = playground.getByRole("button", { name: /^Send/ });

  await expect(project).toHaveValue("");
  await expect(sample).toContainText("client.queryUsers({})");
  await send.click();
  await expect.poll(() => projects).toEqual([null]);

  await project.fill("proj_docs_target");
  await expect(sample).toContainText('project_id: "proj_docs_target"');
  await send.click();
  await expect.poll(() => projects).toEqual([null, "proj_docs_target"]);

  await playground.getByRole("button", { name: "Unset", exact: true }).click();
  await expect(sample).toContainText("client.queryUsers({})");
  await send.click();
  await expect.poll(() => projects).toEqual([null, "proj_docs_target", null]);
});

for (const operation of [
  { section: "users", id: "queryUsers", title: "Query users" },
  { section: "teams", id: "createTeam", title: "Create team" },
]) {
  test(`${operation.title}: the TypeScript sample follows the selected authentication`, async ({
    page,
    context,
    baseURL,
  }) => {
    await stubSession(context, baseURL!, () => ada);
    await page.goto(`/docs/reference/api/${operation.section}/${operation.id}`);
    await page.getByRole("button", { name: "Try in Playground" }).click();
    const playground = page.getByRole("dialog", { name: operation.title });
    const sample = playground.locator("pre").filter({ hasText: "@zitadel/api/" });
    await expect(playground.getByText("Sent with your session", { exact: false })).toContainText(
      ada.display,
    );
    await expect(sample).toContainText("@zitadel/api/config");
    await expect(sample).not.toContainText("ZITADEL_PROJECT_SECRET");
    // A session-authenticated write must show how to obtain and send CSRF.
    if (operation.id === "createTeam") {
      await expect(sample).toContainText("setApiCsrfToken");
      await expect(sample).toContainText("client.getMySessionCsrfToken()");
      // Required project parameters still start with their documented example.
      await expect(
        playground.getByRole("textbox", { name: "project_id", exact: true }),
      ).toHaveValue("proj_01KWH1P4MYS7F0N9WD3P2E4YM5");
    } else {
      await expect(sample).not.toContainText("setApiCsrfToken");
    }

    await playground
      .getByRole("combobox")
      .filter({ hasText: /^sessionCookie$/ })
      .click();
    await page.getByRole("option", { name: "oauth2", exact: true }).click();
    await expect(sample).toContainText("token: process.env.ZITADEL_PROJECT_SECRET!");
    await expect(sample).not.toContainText("setApiCsrfToken");
    const authorization = playground.getByRole("textbox", { name: "Authorization", exact: true });
    await authorization.fill("Bearer docs-test-secret");
    await expect(sample).not.toContainText("docs-test-secret");
    // Even an empty bearer input still selects project-secret authentication.
    await authorization.fill("");
    await expect(sample).toContainText("token: process.env.ZITADEL_PROJECT_SECRET!");

    await playground
      .getByRole("combobox")
      .filter({ hasText: /^oauth2$/ })
      .click();
    await page.getByRole("option", { name: "sessionCookie", exact: true }).click();
    await expect(sample).toContainText("@zitadel/api/config");
    await expect(sample).not.toContainText("ZITADEL_PROJECT_SECRET");
  });
}

test("a signed-out reader's sample starts with project-secret authentication", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  await context.route(
    (url) => url.origin === origin && url.pathname === "/api/v1/sessions/me",
    (route) => route.fulfill({ status: 401, json: { code: "auth.unauthorized" } }),
  );
  await page.goto("/docs/reference/api/users/queryUsers");
  await page.getByRole("button", { name: "Try in Playground" }).click();
  const playground = page.getByRole("dialog", { name: "Query users" });
  await expect(
    playground.getByRole("textbox", { name: "Authorization", exact: true }),
  ).toBeVisible();
  const sample = playground.locator("pre").filter({ hasText: "@zitadel/api/" });
  await expect(sample).toContainText("token: process.env.ZITADEL_PROJECT_SECRET!");
  await expect(sample).toContainText("client.queryUsers({})");

  await playground
    .getByRole("combobox")
    .filter({ hasText: /^oauth2$/ })
    .click();
  await page.getByRole("option", { name: "sessionCookie", exact: true }).click();
  await expect(sample).toContainText("@zitadel/api/config");
  await expect(sample).not.toContainText("ZITADEL_PROJECT_SECRET");
});
