import { type BrowserContext, expect, type Page, test } from "@playwright/test";

const ada = { user_id: "usr_picker_ada", display: "Ada Picker" };
const grace = { user_id: "usr_picker_grace", display: "Grace Picker" };
const shop = { id: "proj_picker_shop", name: "Shop" };
const store = { id: "proj_picker_store", name: "Store" };

// Every API call is answered here, including Send: these tests can also run
// against a deployment without reading or changing anyone's real projects.
async function stubApi(context: BrowserContext, baseURL: string) {
  const state = {
    reader: ada as typeof ada | null,
    status: 200,
    projects: [shop],
    listed: [] as URL[],
    sent: [] as URL[],
  };
  const origin = new URL(baseURL).origin;
  await context.route(
    (url) => url.origin === origin && !url.pathname.startsWith("/docs"),
    async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/sessions/me") {
        await route.fulfill({ status: state.reader ? 200 : 401, json: { user: state.reader } });
      } else if (url.pathname === "/sessions/me/csrf") {
        await route.fulfill({ json: { csrf_token: "csrf-picker-test" } });
      } else if (url.pathname === "/users/me/projects") {
        state.listed.push(url);
        // Status 0: the request fails without an answer.
        if (state.status === 0) {
          await route.abort("failed");
          return;
        }
        const more = url.searchParams.has("page_token");
        await route.fulfill({
          status: state.status,
          json: {
            projects: more ? [store] : state.projects,
            next_page_token: more || state.projects.length === 0 ? null : "picker-next",
          },
        });
      } else if (url.pathname === "/teams/query" || url.pathname.startsWith("/projects/")) {
        state.sent.push(url);
        await route.fulfill({ json: { teams: [], ...shop } });
      } else {
        await route.abort();
      }
    },
  );
  return state;
}

async function openPlayground(page: Page, operation = "teams/queryTeams", title = "Query teams") {
  const session = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/sessions/me",
  );
  await page.goto(`/docs/reference/api/${operation}`);
  // Wait for session discovery before opening: the operation's auth order
  // follows signed-in state, and a playground already open retains edits.
  await session;
  await page.getByRole("button", { name: "Try in Playground" }).click();
  return page.getByRole("dialog", { name: title });
}

test("project selection is lazy, searchable, paginated, and updates the request and samples", async ({
  page,
  context,
  baseURL,
}) => {
  const state = await stubApi(context, baseURL!);
  const playground = await openPlayground(page);
  const project = playground.getByRole("textbox", { name: "project_id", exact: true });
  const original = await project.inputValue();
  expect(state.listed).toEqual([]);
  await playground.getByRole("button", { name: "Choose project…" }).click();
  await expect(
    playground.getByRole("button", { name: "Shop proj_picker_shop", exact: true }),
  ).toBeVisible();
  // Loading suggestions never chooses the first project or overwrites an edit.
  await expect(project).toHaveValue(original);
  await playground.getByRole("searchbox", { name: "Search your projects" }).fill("sho");
  await expect.poll(() => state.listed.at(-1)?.searchParams.get("name_contains")).toBe("sho");
  await expect(playground.getByText("Loading projects…", { exact: true })).toBeHidden();
  await playground.getByRole("button", { name: "Load more projects" }).click();
  await expect(
    playground.getByRole("button", { name: "Store proj_picker_store", exact: true }),
  ).toBeVisible();
  expect(state.listed.at(-1)?.searchParams.get("page_token")).toBe("picker-next");
  expect(state.listed.at(-1)?.searchParams.get("name_contains")).toBe("sho");
  expect(state.listed.every((url) => !url.searchParams.has("project_id"))).toBe(true);
  await playground.getByRole("button", { name: "Store proj_picker_store", exact: true }).click();
  await expect(project).toHaveValue(store.id);
  await expect(playground.locator("pre").filter({ hasText: "queryTeams" })).toContainText(store.id);
  await playground.getByRole("button", { name: /^Send/ }).click();
  await expect.poll(() => state.sent.at(-1)?.searchParams.get("project_id")).toBe(store.id);

  // Reopening starts at the first page rather than appending the last page
  // again, while retaining the explicitly selected value.
  await playground.getByRole("button", { name: "Store · proj_picker_store", exact: true }).click();
  await expect(
    playground.getByRole("button", { name: "Shop proj_picker_shop", exact: true }),
  ).toBeVisible();
  await expect(
    playground.getByRole("button", { name: "Store proj_picker_store", exact: true }),
  ).toBeHidden();
  expect(state.listed.at(-1)?.searchParams.has("page_token")).toBe(false);
  await expect(project).toHaveValue(store.id);

  await project.fill("proj_manual");
  await expect(playground.getByRole("button", { name: "Choose project…" })).toBeVisible();
  await playground.getByRole("button", { name: /^Send/ }).click();
  await expect.poll(() => state.sent.at(-1)?.searchParams.get("project_id")).toBe("proj_manual");
  await playground.getByRole("button", { name: "Use session’s project" }).click();
  await playground.getByRole("button", { name: /^Send/ }).click();
  await expect.poll(() => state.sent.length).toBe(3);
  expect(state.sent[2]?.searchParams.has("project_id")).toBe(false);
});

test("errors and empty results keep manual entry usable and allow retry", async ({
  page,
  context,
  baseURL,
}) => {
  const state = await stubApi(context, baseURL!);
  state.status = 0;
  const playground = await openPlayground(page);
  await playground.getByRole("button", { name: "Choose project…" }).click();
  // The picker's own sentence, not the browser's "Failed to fetch".
  await expect(playground.getByRole("alert")).toContainText(
    "Projects could not be loaded. You can still enter an ID manually.",
  );
  state.status = 503;
  await playground.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(playground.getByRole("alert")).toContainText("503");
  await playground.getByRole("textbox", { name: "project_id", exact: true }).fill("proj_manual");
  state.status = 200;
  state.projects = [];
  await playground.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(playground.getByText("No accessible projects.", { exact: true })).toBeVisible();
  await playground.getByRole("searchbox").fill("absent");
  await expect(playground.getByText("No matching projects.", { exact: true })).toBeVisible();
  await expect(playground.getByRole("textbox", { name: "project_id", exact: true })).toHaveValue(
    "proj_manual",
  );
});

test("account changes discard a picked project and load the new account's projects", async ({
  page,
  context,
  baseURL,
}) => {
  const state = await stubApi(context, baseURL!);
  const playground = await openPlayground(page);
  await playground.getByRole("button", { name: "Choose project…" }).click();
  await playground.getByRole("button", { name: "Shop proj_picker_shop", exact: true }).click();
  await expect(playground.locator("pre").filter({ hasText: "queryTeams" })).toContainText(shop.id);
  // The selection's owner survives unmounting the playground, so reopening
  // cannot silently carry a picked project into a different account.
  await page.keyboard.press("Escape");
  await expect(playground).toBeHidden();
  await page.getByRole("button", { name: "Try in Playground" }).click();
  state.reader = grace;
  state.projects = [store];
  await playground.getByRole("button", { name: /^Send/ }).click();
  const changed = playground.getByText("Your account changed. Choose a project again.");
  await expect(changed).toBeVisible();
  await expect(
    playground.getByText("Sent with your session, signed in as", { exact: false }),
  ).toContainText(grace.display);
  expect(state.sent).toEqual([]);
  // An ID entered by hand sets the project again too.
  const project = playground.getByRole("textbox", { name: "project_id", exact: true });
  await project.fill("proj_manual");
  await expect(changed).toBeHidden();
  await playground.getByRole("button", { name: "Choose project…" }).click();
  await expect(
    playground.getByRole("button", { name: "Store proj_picker_store", exact: true }),
  ).toBeVisible();
  await expect(
    playground.getByRole("button", { name: "Shop proj_picker_shop", exact: true }),
  ).toBeHidden();
  await playground.getByRole("button", { name: "Store proj_picker_store", exact: true }).click();
  await playground.getByRole("button", { name: /^Send/ }).click();
  await expect.poll(() => state.sent.at(-1)?.searchParams.get("project_id")).toBe(store.id);
});

test("bearer authentication hides session project suggestions and keeps manual scope", async ({
  page,
  context,
  baseURL,
}) => {
  const state = await stubApi(context, baseURL!);
  const playground = await openPlayground(page);
  await playground.getByRole("combobox").filter({ hasText: "sessionCookie" }).click();
  await page.getByRole("option", { name: "oauth2", exact: true }).click();
  await expect(playground.getByRole("button", { name: "Choose project…" })).toBeHidden();
  await playground.getByRole("textbox", { name: "project_id", exact: true }).fill("proj_bearer");
  expect(state.listed).toEqual([]);
});

test("project path parameters use the picker without offering an implicit session scope", async ({
  page,
  context,
  baseURL,
}) => {
  const state = await stubApi(context, baseURL!);
  const playground = await openPlayground(page, "projects/getProject", "Get project");
  await playground.getByRole("button", { name: "Choose project…" }).click();
  await playground.getByRole("button", { name: "Shop proj_picker_shop", exact: true }).click();
  await expect(playground.getByRole("button", { name: "Use session’s project" })).toBeHidden();
  await playground.getByRole("button", { name: /^Send/ }).click();
  await expect.poll(() => state.sent.at(-1)?.pathname).toBe(`/projects/${shop.id}`);
});

test("session home-project assertions never offer the target-project picker", async ({
  page,
  context,
  baseURL,
}) => {
  const state = await stubApi(context, baseURL!);
  const playground = await openPlayground(
    page,
    "projects/listMyProjects",
    "List the projects I can act on",
  );
  await expect(playground.getByRole("textbox", { name: "project_id", exact: true })).toBeVisible();
  await expect(playground.getByRole("button", { name: "Choose project…" })).toBeHidden();
  expect(state.listed).toEqual([]);
});

test("a signed-out reader can enter an ID but cannot load session projects", async ({
  page,
  context,
  baseURL,
}) => {
  const state = await stubApi(context, baseURL!);
  state.reader = null;
  const playground = await openPlayground(page);
  await playground.getByRole("combobox").filter({ hasText: "oauth2" }).click();
  await page.getByRole("option", { name: "sessionCookie", exact: true }).click();
  await expect(playground.getByText("Sign in to the", { exact: false })).toBeVisible();
  await expect(playground.getByRole("button", { name: "Choose project…" })).toBeHidden();
  await playground.getByRole("textbox", { name: "project_id", exact: true }).fill("proj_manual");
  expect(state.listed).toEqual([]);
});
