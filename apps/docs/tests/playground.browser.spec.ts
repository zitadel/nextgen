import { type BrowserContext, expect, type Page, test } from "@playwright/test";

/**
 * The API playground sends only reads with the reader's session, and those only
 * as the account the page shows (components/session-auth.tsx). A context route
 * answers every session call and every request the tests send, so they write
 * nothing, against the local build or a deployment.
 */

interface Reader {
  user_id: string;
  display: string;
}

/** A request the stub answered in the API's place. */
interface Sent {
  method: string;
  path: string;
  authorization?: string;
}

const ada: Reader = { user_id: "usr_docs_ada", display: "Ada from the docs tests" };
const grace: Reader = { user_id: "usr_docs_grace", display: "Grace from the docs tests" };

/** The API's paths these tests send to; the stub answers each of them. */
const stubbed = /^\/(?:sessions\/me|teams(?:\/query)?|users\/me|grants\/[^/]+)$/;

/**
 * Answers the session reads as `reader()` says, and records every other
 * request. With `stall`, only the page's own first read of the session
 * answers.
 */
async function stubSession(
  context: BrowserContext,
  baseURL: string,
  reader: () => Reader,
  stall = false,
): Promise<{ sent: Sent[]; sessionReads: () => number }> {
  const origin = new URL(baseURL).origin;
  const sent: Sent[] = [];
  let reads = 0;
  await context.route(
    (url) => url.origin === origin && stubbed.test(url.pathname),
    async (route) => {
      const request = route.request();
      const method = request.method();
      const path = new URL(request.url()).pathname;
      if (method === "GET" && path === "/sessions/me") {
        reads += 1;
        if (!stall || reads === 1) await route.fulfill({ json: { user: reader() } });
      } else {
        const { authorization } = await request.allHeaders();
        sent.push({ method, path, authorization });
        await route.fulfill(method === "DELETE" ? { status: 204 } : { json: {} });
      }
    },
  );
  return { sent, sessionReads: () => reads };
}

/** Opens an operation's playground. */
async function openPlayground(page: Page, operation: string, title: string) {
  await page.goto(`/docs/reference/api/${operation}`);
  await page.getByRole("button", { name: "Try in Playground" }).click();
  const playground = page.getByRole("dialog", { name: title });
  return {
    playground,
    // The session's note on a read, once the page knows the reader.
    note: playground.getByText("Sent with your session", { exact: false }),
    // The session's note on a write.
    readsOnly: playground.getByText("sends only reads with your session", { exact: false }),
    send: playground.getByRole("button", { name: /^Send/ }),
  };
}

test("a read goes out with the session: a GET and a POST …/query", async ({
  page,
  context,
  baseURL,
}) => {
  const { sent } = await stubSession(context, baseURL!, () => ada);
  const reads = [
    {
      operation: "users/getMyUser",
      title: "Get my user information",
      method: "GET",
      path: "/users/me",
    },
    { operation: "teams/queryTeams", title: "Query teams", method: "POST", path: "/teams/query" },
  ];
  for (const { operation, title, method, path } of reads) {
    const { note, send } = await openPlayground(page, operation, title);
    // The note names the account and the API it acts on, the page's own.
    await expect(note).toContainText(ada.display);
    await expect(note).toContainText(new URL(baseURL!).origin);
    await send.click();
    await expect.poll(() => sent.at(-1)).toEqual({ method, path });
  }
});

test("the session sends no write: a POST and a DELETE", async ({ page, context, baseURL }) => {
  const { sent, sessionReads } = await stubSession(context, baseURL!, () => ada);
  const writes = [
    { operation: "teams/createTeam", title: "Create team" },
    { operation: "grants/deleteGrant", title: "Revoke grant" },
  ];
  for (const { operation, title } of writes) {
    const { playground, readsOnly, send } = await openPlayground(page, operation, title);
    await expect(readsOnly).toBeVisible();
    await send.click();
    const refusal = playground.getByRole("alert");
    await expect(refusal).toContainText("Not sent");
    await expect(refusal).toContainText("The playground sends only reads with your session");
    // Nothing failed on the way to a server, so Fumadocs' hint for that stays out.
    await expect(playground.getByText("a proxy is needed", { exact: false })).toHaveCount(0);
  }
  expect(sent).toEqual([]);
  // Refused before it asked whose session it is: only each page's own read.
  expect(sessionReads()).toBe(writes.length);
});

test("a request with a bearer token goes as it is", async ({ page, context, baseURL }) => {
  const { sent, sessionReads } = await stubSession(context, baseURL!, () => ada);
  const { playground, readsOnly, send } = await openPlayground(
    page,
    "teams/createTeam",
    "Create team",
  );
  await expect(readsOnly).toBeVisible();

  await playground
    .getByRole("combobox")
    .filter({ hasText: /^sessionCookie$/ })
    .click();
  await page.getByRole("option", { name: "oauth2", exact: true }).click();
  await playground
    .getByRole("textbox", { name: "Authorization", exact: true })
    .fill("Bearer docs-test-secret");
  await send.click();
  await expect
    .poll(() => sent)
    .toEqual([{ method: "POST", path: "/teams", authorization: "Bearer docs-test-secret" }]);
  // The playground did not even ask whose session it is.
  expect(sessionReads()).toBe(1);
});

test("the playground sends nothing as another account than the one it shows", async ({
  page,
  context,
  baseURL,
}) => {
  let reader = ada;
  const { sent } = await stubSession(context, baseURL!, () => reader);
  const { playground, note, send } = await openPlayground(page, "teams/queryTeams", "Query teams");
  await expect(note).toContainText(ada.display);

  // Another tab signs out and in as someone else.
  reader = grace;
  await send.click();
  await expect(playground.getByRole("alert")).toContainText("Your session changed");
  await expect(note).toContainText(grace.display);
  expect(sent).toEqual([]);

  // Sent again, it goes as the account the page now shows.
  await send.click();
  await expect.poll(() => sent).toEqual([{ method: "POST", path: "/teams/query" }]);
});

test("a session lookup that never answers ends with the playground's timeout", async ({
  page,
  context,
  baseURL,
}) => {
  // Fumadocs gives a request 10 seconds.
  test.slow();
  const { sent } = await stubSession(context, baseURL!, () => ada, true);
  const { playground, note, send } = await openPlayground(page, "teams/queryTeams", "Query teams");
  await expect(note).toContainText(ada.display);

  await send.click();
  await expect(playground.getByText("TimeoutError", { exact: false })).toBeVisible({
    timeout: 20_000,
  });
  // A request that failed keeps Fumadocs' own display, hint and all.
  await expect(playground.getByText("a proxy is needed", { exact: false })).toBeVisible();
  expect(sent).toEqual([]);
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
    (url) => url.origin === origin && url.pathname === "/users/query",
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
    // The playground opens on the session once the page knows the reader. On
    // a write its note says it sends none with it; the sample still shows how.
    if (operation.id === "createTeam") {
      await expect(
        playground.getByText("sends only reads with your session", { exact: false }),
      ).toBeVisible();
    } else {
      await expect(playground.getByText("Sent with your session", { exact: false })).toContainText(
        ada.display,
      );
    }
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
    (url) => url.origin === origin && url.pathname === "/sessions/me",
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
