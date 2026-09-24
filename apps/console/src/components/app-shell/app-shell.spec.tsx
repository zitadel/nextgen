import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { scopedPath } from "@/lib/project-scope.fixture";

import { THEME_STORAGE_KEY } from "../../theme";
import { createAppRouter } from "../../router";

// The `_authed` layout guards every screen behind `GET /sessions/me`
// (Console ADR 0003); mock the auth module so routes render as signed in.
vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  const { makeTestSession } = await import("@/auth/session.fixture");
  return { ...actual, fetchSession: vi.fn(async () => makeTestSession()) };
});


/**
 * The sidebar lists only screens that exist. Entries come from `staticData.nav`
 * on the route tree (Console ADR 0001) and every one is a link.
 *
 * It used to render the Figma mock's full 7 items, with the 4 unbuilt ones as
 * `aria-disabled` rows. That is what this spec now guards against: a disabled
 * row advertises a feature and reads as "you cannot do this" rather than "this
 * does not exist". Also covers the theme toggle writing `data-theme` and
 * persisting the preference.
 */
// The top-level surfaces with a design hand-off, in the order the design puts
// them. `User schemas` nests beneath `Users` (`Schema directory` frame) rather
// than adding a second top-level row.
const NAV_ORDER = ["Projects", "Teams", "Users", "Login flows"];
const NESTED_NAV = { parent: "Users", label: "User schemas" };
const NESTED_BRANDING = { parent: "Login flows", label: "Branding" };
// Absent for two different reasons, both deliberate:
//   - the first four have no endpoint at all
//   - Sessions was built, but `POST /sessions/query` answers 501 (#699)
const NEVER_SHOWN = [
  "App groups",
  "Applications",
  "Analytics",
  "Activity Log",
  "Sessions",
];

// A path pattern rather than an absolute URL: this spec imports the router
// statically, so `api/zitadel.ts` evaluates its base URL before `vi.stubEnv`
// could run — the request goes to the relative default.
//
// `GET /users/me/projects` is the authorized-projects query (#1228): what the
// signed-in person can act on, read with the session cookie.
const MY_PROJECTS = "*/api/users/me/projects";
// `/` lands on Teams, so most tests read it once a project is selected.
const TEAMS_QUERY = "*/api/teams/query";
const server = setupServer(
  http.get(MY_PROJECTS, () =>
    HttpResponse.json({ projects: [{ id: "proj_1", name: "console-dev" }] }),
  ),
  http.post(TEAMS_QUERY, () => HttpResponse.json({ teams: [] })),
);

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderShell(path = "/") {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });
  render(<RouterProvider router={router} />);
  return router;
}

describe("app shell navigation", () => {
  it("lists only built screens, every one of them a link", async () => {
    renderShell();
    await screen.findByRole("link", { name: /^Users/ });
    const nav = within(screen.getByRole("navigation", { name: "Primary" }));

    // Only the top level: nested entries render inside their parent's
    // `<li>`, so `getAllByRole("listitem")` alone would conflate the two.
    const items = nav
      .getAllByRole("listitem")
      .filter((li) => li.parentElement?.dataset.slot === "sidebar-menu");
    expect(items.map((li) => within(li).getAllByRole("link")[0]?.textContent?.trim())).toEqual(
      NAV_ORDER,
    );

    // Every row navigates somewhere (the logo is a separate Home link outside
    // the list), so there is no row that looks like a destination but is not.
    const linkedRows = items.filter((li) => within(li).queryAllByRole("link").length > 0);
    expect(linkedRows).toHaveLength(NAV_ORDER.length);
  });

  it("nests User schemas under Users rather than adding a top-level row", async () => {
    renderShell();
    await screen.findByRole("link", { name: /^Users/ });
    const nav = within(screen.getByRole("navigation", { name: "Primary" }));

    const [parent] = nav
      .getAllByRole("listitem")
      .filter((li) => within(li).getAllByRole("link")[0]?.textContent?.trim() === NESTED_NAV.parent);
    expect(parent).toBeDefined();
    expect(
      within(parent as HTMLElement).getByRole("link", { name: NESTED_NAV.label }),
    ).toHaveAttribute("href", scopedPath("/schemas", "proj_1"));
  });

  it("nests Branding under Login flows rather than adding a top-level row", async () => {
    renderShell();
    await screen.findByRole("link", { name: /^Login flows/ });
    const nav = within(screen.getByRole("navigation", { name: "Primary" }));

    const [parent] = nav
      .getAllByRole("listitem")
      .filter(
        (li) => within(li).getAllByRole("link")[0]?.textContent?.trim() === NESTED_BRANDING.parent,
      );
    expect(parent).toBeDefined();
    expect(
      within(parent as HTMLElement).getByRole("link", { name: NESTED_BRANDING.label }),
    ).toHaveAttribute("href", scopedPath("/branding", "proj_1"));
  });

  it("lists only unscoped screens until a project is selected", async () => {
    // Several to choose from, so `/` lands on Projects with nothing selected.
    server.use(
      http.get(MY_PROJECTS, () =>
        HttpResponse.json({
          projects: [
            { id: "proj_1", name: "River" },
            { id: "proj_2", name: "Delta" },
          ],
        }),
      ),
    );
    const router = renderShell();
    await vi.waitFor(() => expect(router.state.location.pathname).toBe("/projects"));
    const pill = await screen.findByRole("button", { name: "Switch project" });
    await vi.waitFor(() => expect(pill).toHaveTextContent("Select a project"));

    const nav = within(screen.getByRole("navigation", { name: "Primary" }));
    expect(nav.getAllByRole("link").map((link) => link.textContent?.trim())).toEqual([
      "Projects",
    ]);
  });

  it("does not advertise screens that have no endpoint behind them", async () => {
    renderShell();
    await screen.findByRole("link", { name: /^Users/ });
    const nav = within(screen.getByRole("navigation", { name: "Primary" }));

    for (const label of NEVER_SHOWN) {
      expect(nav.queryByText(label)).not.toBeInTheDocument();
    }
  });
});

/**
 * The sidebar has two views and the route picks between them, so a settings URL
 * restores the Settings view rather than dropping the operator back into Portal
 * chrome. The account dropdown is the way in; `Back to app` is the way out.
 */
describe("settings view", () => {
  it("shows the portal nav and the account dropdown's entry point by default", async () => {
    renderShell();
    await screen.findByRole("link", { name: /^Users/ });
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^Account:/ }));
    // Log out, not Sign out, and Settings alongside it — both per the design.
    expect(await screen.findByRole("menuitem", { name: "Log out" })).toBeInTheDocument();
    // The selection rides along, so `Back to app` returns to the same project.
    expect(screen.getByRole("menuitem", { name: "Settings" })).toHaveAttribute(
      "href",
      scopedPath("/settings", "proj_1"),
    );
  });

  it("swaps the portal nav for the settings view on a settings URL", async () => {
    renderShell("/settings");
    // The way back out is present...
    expect(await screen.findByRole("link", { name: "Back to app" })).toHaveAttribute("href", "/");
    // ...and the portal list is gone rather than sitting underneath it.
    expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Users/ })).not.toBeInTheDocument();
  });

  it("drops the context bar in the settings view", async () => {
    // The settings frames draw no bar. Its project switcher and theme toggle
    // are portal chrome; the sidebar keeps a trigger of its own, so the
    // collapse is not lost with them.
    renderShell("/settings");
    await screen.findByRole("link", { name: "Back to app" });

    expect(screen.queryByRole("button", { name: "Switch project" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Dark" })).not.toBeInTheDocument();
    // The sidebar keeps its own triggers (header row and rail), so the
    // collapse survives the bar going away.
    expect(screen.getAllByRole("button", { name: "Toggle Sidebar" }).length).toBeGreaterThan(0);
  });
});

describe("theme toggle", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });
  afterEach(() => localStorage.clear());

  it("switches data-theme and persists the preference", async () => {
    renderShell();
    await screen.findByRole("link", { name: /^Users/ });

    await userEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");

    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });
  it("names the project from the API rather than a hardcoded label", async () => {
    // The switcher used to hardcode "River".
    renderShell();
    const switcher = await screen.findByRole("button", { name: "Switch project" });
    await vi.waitFor(() => expect(switcher).toHaveTextContent("console-dev"));
    expect(switcher).not.toHaveTextContent("River");
  });
});

/**
 * The pill shows the projects the signed-in person can act on (#1237). It used
 * to ask `POST /projects/query`, which the server pins to the calling
 * credential's home project: one row at most, the platform project for a
 * browser session, and a refusal on the embedded console, where the pill stayed
 * a skeleton for good.
 */
describe("project pill", () => {
  it("shows a project somebody else granted, not the console's own", async () => {
    // Nothing ties this id to `getConsoleProjectId()`: the grant is the only
    // reason it is listed, and that is reason enough to show it.
    server.use(
      http.get(MY_PROJECTS, () =>
        HttpResponse.json({ projects: [{ id: "proj_theirs", name: "Granted to me" }] }),
      ),
    );
    renderShell();

    const pill = await screen.findByRole("button", { name: "Switch project" });
    await vi.waitFor(() => expect(pill).toHaveTextContent("Granted to me"));
  });

  it("marks the selected project and lists every one as a way to select it", async () => {
    server.use(
      http.get(MY_PROJECTS, () =>
        HttpResponse.json({
          projects: [
            { id: "proj_1", name: "River" },
            { id: "proj_2", name: "Delta" },
          ],
        }),
      ),
    );
    renderShell(scopedPath("/teams", "proj_2"));

    const pill = await screen.findByRole("button", { name: "Switch project" });
    await vi.waitFor(() => expect(pill).toHaveTextContent("Delta"));
    expect(pill).not.toHaveTextContent("River");

    await userEvent.click(pill);
    const list = within(await screen.findByRole("list", { name: "Switch project" }));
    expect(list.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "River",
      "Delta",
    ]);
    // Selecting is navigating — the selection lives in the URL — so the rows
    // are links, and a scoped list stays where it is under the new project.
    expect(list.queryAllByRole("button")).toEqual([]);
    expect(list.getByRole("link", { name: "River" })).toHaveAttribute(
      "href",
      scopedPath("/teams", "proj_1"),
    );
    expect(list.getByText("Delta").closest("li")).toHaveAttribute("aria-current", "true");
    expect(list.getByText("River").closest("li")).not.toHaveAttribute("aria-current");
  });

  it("re-scopes the screen and closes the list when a row is followed", async () => {
    const queried: string[] = [];
    server.use(
      http.get(MY_PROJECTS, () =>
        HttpResponse.json({
          projects: [
            { id: "proj_1", name: "River" },
            { id: "proj_2", name: "Delta" },
          ],
        }),
      ),
      http.post(TEAMS_QUERY, ({ request }) => {
        queried.push(new URL(request.url).searchParams.get("project_id") ?? "");
        return HttpResponse.json({ teams: [] });
      }),
    );
    const router = renderShell(scopedPath("/teams", "proj_1"));

    const pill = await screen.findByRole("button", { name: "Switch project" });
    await vi.waitFor(() => expect(pill).toHaveTextContent("River"));
    await userEvent.click(pill);
    const list = within(await screen.findByRole("list", { name: "Switch project" }));
    await userEvent.click(list.getByRole("link", { name: "Delta" }));

    await vi.waitFor(() => expect(router.state.location.search).toMatchObject({ project: "proj_2" }));
    expect(router.state.location.pathname).toBe("/teams");
    await vi.waitFor(() => expect(pill).toHaveTextContent("Delta"));
    expect(screen.queryByRole("list", { name: "Switch project" })).not.toBeInTheDocument();
    await vi.waitFor(() => expect(queried).toEqual(["proj_1", "proj_2"]));
  });

  it("lands on the new project's first screen when selected from an unscoped one", async () => {
    server.use(
      http.get(MY_PROJECTS, () =>
        HttpResponse.json({
          projects: [
            { id: "proj_1", name: "River" },
            { id: "proj_2", name: "Delta" },
          ],
        }),
      ),
    );
    const router = renderShell(scopedPath("/projects", "proj_1"));

    const pill = await screen.findByRole("button", { name: "Switch project" });
    await vi.waitFor(() => expect(pill).toHaveTextContent("River"));
    await userEvent.click(pill);
    const list = within(await screen.findByRole("list", { name: "Switch project" }));
    await userEvent.click(list.getByRole("link", { name: "Delta" }));

    await vi.waitFor(() => expect(router.state.location.pathname).toBe("/teams"));
    expect(router.state.location.search).toMatchObject({ project: "proj_2" });
  });

  it("says there are no projects instead of loading forever", async () => {
    server.use(http.get(MY_PROJECTS, () => HttpResponse.json({ projects: [] })));
    renderShell();

    const pill = await screen.findByRole("button", { name: "Switch project" });
    await vi.waitFor(() => expect(pill).toHaveTextContent("No projects"));

    await userEvent.click(pill);
    const list = within(await screen.findByRole("list", { name: "Switch project" }));
    expect(list.getByText("No projects")).toBeInTheDocument();
  });

  it("falls back to the same empty state when the query fails", async () => {
    // The chrome is not worth an error boundary: a failed read degrades to the
    // empty pill rather than taking every screen down with it.
    server.use(http.get(MY_PROJECTS, () => new HttpResponse(null, { status: 500 })));
    renderShell();

    const pill = await screen.findByRole("button", { name: "Switch project" });
    await vi.waitFor(() => expect(pill).toHaveTextContent("No projects"));
  });
});
