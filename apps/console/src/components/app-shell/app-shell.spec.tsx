import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { scopedPath } from "@/test/project-scope.fixture";

import { THEME_STORAGE_KEY } from "../../theme";
import { createAppRouter } from "../../router";
import { server } from "@/test/msw";

// The `_authed` layout guards every screen behind `GET /sessions/me`
// (Console ADR 0003); mock the auth module so routes render as signed in.
vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  const { makeTestSession } = await import("@/test/session.fixture");
  return { ...actual, fetchSession: vi.fn(async () => makeTestSession()) };
});

/**
 * The sidebar lists only screens that exist. Entries come from `staticData.nav`
 * on the route tree (Console ADR 0001) and every one is a link.
 *
 * Guards against `aria-disabled` rows for unbuilt screens. Also covers the
 * theme toggle writing `data-theme` and persisting the preference.
 */
// The Projects overview first, then the selected project's contents in the
// order the design puts them, then the project's own settings. `User schemas`
// nests beneath `Users` rather than adding a second
// top-level row.
const NAV_ORDER = [
  "Projects",
  "Teams",
  "Users",
  "Authentication",
  "Login flows",
  "Project settings",
];
const NESTED_NAV = { parent: "Users", label: "User schemas" };
const NESTED_BRANDING = { parent: "Login flows", label: "Branding" };
// Absent for two different reasons, both deliberate:
//   - the first four have no endpoint at all
//   - Sessions was built, but `POST /sessions/query` answers 501 (#699)
const NEVER_SHOWN = ["App groups", "Applications", "Analytics", "Activity Log", "Sessions"];

// `GET /users/me/projects` is the authorized-projects query (#1228): what the
// signed-in person can act on, read with the session cookie.
const MY_PROJECTS = "*/api/users/me/projects";
// `/` lands on Teams, so most tests read it once a project is selected.
const TEAMS_QUERY = "*/api/teams/query";
// `/settings` lands on Profile, which reads the signed-in person's own record.
const MY_USER = "*/api/users/me";
beforeEach(() =>
  server.use(
    http.get(MY_PROJECTS, () =>
      HttpResponse.json({ projects: [{ id: "proj_1", name: "console-dev" }] }),
    ),
    http.get(MY_USER, () =>
      HttpResponse.json({ id: "user_1", attributes: { email: "dev@zitadel.local" } }),
    ),
    http.post(TEAMS_QUERY, () => HttpResponse.json({ teams: [] })),
  ),
);

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
      .filter(
        (li) => within(li).getAllByRole("link")[0]?.textContent?.trim() === NESTED_NAV.parent,
      );
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

  it("lists only Projects until a project is selected", async () => {
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
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/projects"));
    const pill = await screen.findByRole("button", { name: "Switch project" });
    await waitFor(() => expect(pill).toHaveTextContent("Select a project"));

    const nav = within(screen.getByRole("navigation", { name: "Primary" }));
    const links = nav.queryAllByRole("link");
    expect(links.map((link) => link.textContent?.trim())).toEqual(["Projects"]);
    expect(links[0]).toHaveAttribute("href", "/projects");
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
 * chrome. The account dropdown is the way in; `Back to dashboard` is the way out.
 */
describe("settings view", () => {
  it("shows the portal nav and the account dropdown's entry point by default", async () => {
    renderShell();
    await screen.findByRole("link", { name: /^Users/ });
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^Account:/ }));
    expect(await screen.findByRole("menuitem", { name: "Log out" })).toBeInTheDocument();
    // The selection rides along, so `Back to dashboard` returns to the same project.
    expect(screen.getByRole("menuitem", { name: "Profile" })).toHaveAttribute(
      "href",
      scopedPath("/settings/profile", "proj_1"),
    );
    // The account row opens the screen that renames it.
    expect(screen.getByRole("menuitem", { name: "Test account" })).toHaveAttribute(
      "href",
      scopedPath("/settings/account", "proj_1"),
    );
  });

  it("swaps the portal nav for the settings view on a settings URL", async () => {
    renderShell("/settings");
    // The way back out is present...
    // One project, so it is selected here too, and the way back keeps it.
    expect(await screen.findByRole("link", { name: "Back to dashboard" })).toHaveAttribute(
      "href",
      scopedPath("/", "proj_1"),
    );
    // ...and the portal list is gone rather than sitting underneath it.
    expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Users/ })).not.toBeInTheDocument();
  });

  it("drops the context bar in the settings view", async () => {
    // The settings design draws no bar. Its project switcher and search are
    // portal chrome; the sidebar keeps a trigger of its own, so the
    // collapse is not lost with them.
    renderShell("/settings");
    await screen.findByRole("link", { name: "Back to dashboard" });

    expect(screen.queryByRole("button", { name: "Switch project" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Search" })).not.toBeInTheDocument();
    // The collapse toggle is the sidebar's, so it survives the bar going away.
    expect(document.querySelector('[data-sidebar="trigger"]')).toBeInTheDocument();
  });
});

/**
 * The footer names the signed-in person over the account they work in — their
 * team in the sign-in project — and the sidebar's header carries the one
 * collapse toggle, beside the logo.
 */
describe("sidebar chrome", () => {
  it("names the person and their account in the footer", async () => {
    renderShell();
    const account = await screen.findByRole("button", {
      name: "Account: test.user@example.com",
    });
    await waitFor(() => expect(account).toHaveTextContent("Test account"));
  });

  it("shows the person alone when they are on no team", async () => {
    server.use(
      http.post("*/api/users/query", () =>
        HttpResponse.json({ users: [{ id: "user_test", teams: [] }] }),
      ),
    );
    renderShell();
    await userEvent.click(await screen.findByRole("button", { name: /^Account:/ }));
    expect(await screen.findByRole("menuitem", { name: "Profile" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Test account" })).not.toBeInTheDocument();
  });

  it("collapses from the toggle beside the logo", async () => {
    renderShell();
    await screen.findByRole("link", { name: /^Users/ });
    // One toggle on screen — the top bar no longer carries a second. (The
    // other "Toggle Sidebar" button is shadcn's edge rail.)
    const toggles = document.querySelectorAll('[data-sidebar="trigger"]');
    expect(toggles).toHaveLength(1);
    const toggle = toggles[0] as HTMLElement;
    const sidebar = document.querySelector('[data-slot="sidebar"]');
    expect(sidebar).toHaveAttribute("data-state", "expanded");
    await userEvent.click(toggle);
    expect(sidebar).toHaveAttribute("data-state", "collapsed");
  });
});

/**
 * On a team's page the team is the context, so the bar adds a team switcher
 * after the project's; following a team from it opens that team.
 */
describe("team switcher", () => {
  const TEAMS = [
    { id: "team_a", name: "Acme Inc", status: "active", created_at: "", updated_at: "" },
    { id: "team_b", name: "Acme Billing", status: "active", created_at: "", updated_at: "" },
  ];

  it("is absent until a team is open", async () => {
    renderShell();
    await screen.findByRole("button", { name: "Switch project" });
    expect(screen.queryByRole("button", { name: "Switch team" })).not.toBeInTheDocument();
  });

  it("names the open team and switches to another", async () => {
    server.use(
      http.post(TEAMS_QUERY, () => HttpResponse.json({ teams: TEAMS })),
      http.get("*/api/teams/:teamId", ({ params }) =>
        HttpResponse.json(TEAMS.find((team) => team.id === params.teamId)),
      ),
    );
    const router = renderShell(scopedPath("/teams/team_a", "proj_1"));
    const switcher = await screen.findByRole("button", { name: "Switch team" });
    await waitFor(() => expect(switcher).toHaveTextContent("Acme Inc"));

    await userEvent.click(switcher);
    const list = within(await screen.findByRole("list", { name: "Switch team" }));
    expect(list.getByText("Acme Inc").closest("li")).toHaveAttribute("aria-current", "true");
    await userEvent.click(list.getByRole("link", { name: "Acme Billing" }));

    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/teams/team_b"));
    expect(router.state.resolvedLocation?.search).toMatchObject({ project: "proj_1" });
  });
});

describe("theme toggle", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });
  afterEach(() => localStorage.clear());

  it("switches data-theme from the account menu and persists the preference", async () => {
    renderShell();
    await screen.findByRole("link", { name: /^Users/ });
    // The bar carries search now; the theme lives with the person.
    expect(screen.queryByRole("menuitemradio", { name: "Light" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^Account:/ }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: "Light" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    // Choosing keeps the menu open, so the change can be undone in place.
    expect(screen.getByRole("menuitemradio", { name: "Light" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await userEvent.click(screen.getByRole("menuitemradio", { name: "Dark" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });
  it("names the project from the API rather than a hardcoded label", async () => {
    renderShell();
    const switcher = await screen.findByRole("button", { name: "Switch project" });
    await waitFor(() => expect(switcher).toHaveTextContent("console-dev"));
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
    await waitFor(() => expect(pill).toHaveTextContent("Granted to me"));
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
    await waitFor(() => expect(pill).toHaveTextContent("Delta"));
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
      "/teams?project=proj_1&status=active",
    );
    expect(list.getByText("Delta").closest("li")).toHaveAttribute("aria-current", "true");
    expect(list.getByText("River").closest("li")).not.toHaveAttribute("aria-current");
  });

  it("keeps the list's filters when switching project", async () => {
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
    renderShell(scopedPath("/teams?status=deactivated&q=ops", "proj_2"));

    await userEvent.click(await screen.findByRole("button", { name: "Switch project" }));
    const list = within(await screen.findByRole("list", { name: "Switch project" }));
    const href = (await list.findByRole("link", { name: "River" })).getAttribute("href") ?? "";
    const target = new URL(href, "http://console.invalid");
    expect(target.pathname).toBe("/teams");
    expect(Object.fromEntries(target.searchParams)).toEqual({
      project: "proj_1",
      status: "deactivated",
      q: "ops",
    });
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
    await waitFor(() => expect(pill).toHaveTextContent("River"));
    await userEvent.click(pill);
    const list = within(await screen.findByRole("list", { name: "Switch project" }));
    await userEvent.click(list.getByRole("link", { name: "Delta" }));

    await waitFor(() =>
      expect(router.state.resolvedLocation?.search).toMatchObject({ project: "proj_2" }),
    );
    expect(router.state.resolvedLocation?.pathname).toBe("/teams");
    await waitFor(() => expect(pill).toHaveTextContent("Delta"));
    expect(screen.queryByRole("list", { name: "Switch project" })).not.toBeInTheDocument();
    await waitFor(() => expect(queried).toEqual(["proj_1", "proj_2"]));
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
    await waitFor(() => expect(pill).toHaveTextContent("River"));
    await userEvent.click(pill);
    const list = within(await screen.findByRole("list", { name: "Switch project" }));
    await userEvent.click(list.getByRole("link", { name: "Delta" }));

    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/teams"));
    expect(router.state.resolvedLocation?.search).toMatchObject({ project: "proj_2" });
  });

  it("links to the overview of every project beneath the list", async () => {
    const router = renderShell();
    const pill = await screen.findByRole("button", { name: "Switch project" });
    await waitFor(() => expect(pill).toHaveTextContent("console-dev"));
    await userEvent.click(pill);

    const all = await screen.findByRole("link", { name: "All projects" });
    // The selection rides along: the overview is a look around, not a reset.
    expect(all).toHaveAttribute("href", scopedPath("/projects", "proj_1"));
    await userEvent.click(all);

    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/projects"));
    expect(screen.queryByRole("list", { name: "Switch project" })).not.toBeInTheDocument();
  });

  it("says there are no projects instead of loading forever", async () => {
    server.use(http.get(MY_PROJECTS, () => HttpResponse.json({ projects: [] })));
    renderShell();

    const pill = await screen.findByRole("button", { name: "Switch project" });
    await waitFor(() => expect(pill).toHaveTextContent("No projects"));

    await userEvent.click(pill);
    const list = within(await screen.findByRole("list", { name: "Switch project" }));
    expect(list.getByText("No projects")).toBeInTheDocument();
  });

  it("falls back to the same empty state when the query fails", async () => {
    // The chrome is not worth an error boundary: a failed read degrades to the
    // empty pill rather than taking every screen down with it. The Projects
    // screen reads the same list and does report the failure; that is expected.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      server.use(http.get(MY_PROJECTS, () => new HttpResponse(null, { status: 500 })));
      renderShell();

      const pill = await screen.findByRole("button", { name: "Switch project" });
      await waitFor(() => expect(pill).toHaveTextContent("No projects"));
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});

/**
 * Search moves you somewhere: the bar's field (or ⌘K / Ctrl K) opens a "Go to"
 * palette over pages, the account, teams found by name, projects and Profile.
 */
describe("search", () => {
  it("opens from the bar and goes to a page", async () => {
    const router = renderShell();
    await userEvent.click(await screen.findByRole("button", { name: "Search" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Go to" }));

    await userEvent.type(dialog.getByPlaceholderText("Go to a page, Project or Team"), "tea");
    await userEvent.click(await dialog.findByRole("option", { name: "Teams" }));

    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/teams"));
    expect(screen.queryByRole("dialog", { name: "Go to" })).not.toBeInTheDocument();
  });

  it("toggles with the keyboard shortcut, in the settings view too", async () => {
    renderShell("/settings/profile");
    await screen.findByRole("link", { name: "Back to dashboard" });
    await userEvent.keyboard("{Control>}k{/Control}");
    expect(await screen.findByRole("dialog", { name: "Go to" })).toBeInTheDocument();
    await userEvent.keyboard("{Control>}k{/Control}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Go to" })).not.toBeInTheDocument(),
    );
  });

  it("finds teams by name on the server and opens one", async () => {
    let filter: unknown;
    server.use(
      http.post(TEAMS_QUERY, async ({ request }) => {
        const body = (await request.json()) as { filter?: { field: string; value: string }[] };
        if (body.filter?.some((f) => f.field === "name")) {
          filter = body.filter;
          return HttpResponse.json({
            teams: [
              { id: "team_s", name: "Support", status: "active", created_at: "", updated_at: "" },
            ],
          });
        }
        return HttpResponse.json({ teams: [] });
      }),
      http.get("*/api/teams/team_s", () =>
        HttpResponse.json({
          id: "team_s",
          name: "Support",
          status: "active",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        }),
      ),
    );
    const router = renderShell();
    await userEvent.click(await screen.findByRole("button", { name: "Search" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Go to" }));
    await userEvent.type(dialog.getByPlaceholderText("Go to a page, Project or Team"), "sup");

    await userEvent.click(await dialog.findByRole("option", { name: /Support/ }));
    expect(filter).toContainEqual({ field: "name", operation: "contains", value: "sup" });
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/teams/team_s"));
  });

  it("says when nothing matches", async () => {
    renderShell();
    await userEvent.click(await screen.findByRole("button", { name: "Search" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Go to" }));
    await userEvent.type(dialog.getByPlaceholderText("Go to a page, Project or Team"), "zzzz");
    expect(await dialog.findByText("Nothing matches “zzzz”")).toBeInTheDocument();
  });
});
