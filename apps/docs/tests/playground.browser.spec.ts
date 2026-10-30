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
      ["/sessions/me", "/sessions/me/csrf", "/teams"].includes(url.pathname),
    async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/sessions/me") {
        await route.fulfill({ json: { user: reader() } });
      } else if (path === "/sessions/me/csrf") {
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
