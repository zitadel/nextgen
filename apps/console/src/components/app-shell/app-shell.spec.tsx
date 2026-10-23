import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchSession } from "@/auth/session";
import { makeTestSession } from "@/test/session.fixture";
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
// The design's single-level sidebar ("01 / Nav Level 1"), less the screens
// that are not built (Deployments, Sessions).
const NAV_ORDER = [
  "Projects",
  "Teams",
  "Users",
  "User schemas",
  "Login flows",
  "Branding",
  "Authentication",
  "Project settings",
];
// Absent for two different reasons, both deliberate:
//   - the first four have no endpoint at all
//   - Sessions was built, but `POST /sessions/query` answers 501 (#699)
const NEVER_SHOWN = ["App groups", "Applications", "Analytics", "Activity Log", "Sessions"];

// `GET /users/me/projects` is the authorized-projects query (#1228): what the
// signed-in person can act on, read with the session cookie.
const MY_PROJECTS = "*/api/users/me/projects";
// System, the portal screen that needs no project, reads the server's health.
const HEALTH = "*/api/healthz";
// `/` lands on Users, so most tests read it once a project is selected.
const USERS_QUERY = "*/api/users/query";
// Some tests open on Teams to prove a switch keeps the screen.
const TEAMS_QUERY = "*/api/teams/query";
// `/settings` lands on the profile, which reads the signed-in person's own record.
const MY_USER = "*/api/users/me";
beforeEach(() => {
  // The switcher's recent projects live in localStorage: none carry over.
  localStorage.clear();
  server.use(
    http.get(MY_PROJECTS, () =>
      HttpResponse.json({ projects: [{ id: "proj_1", name: "console-dev" }] }),
    ),
    http.get(MY_USER, () =>
      HttpResponse.json({ id: "user_1", attributes: { email: "dev@zitadel.local" } }),
    ),
    http.post(USERS_QUERY, () => HttpResponse.json({ users: [] })),
    http.post(TEAMS_QUERY, () => HttpResponse.json({ teams: [] })),
  );
});

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

    // One level: every row is a direct item of the menu, none nested.
    const items = nav.getAllByRole("listitem");
    expect(items.every((li) => li.parentElement?.dataset.slot === "sidebar-menu")).toBe(true);
    expect(items.map((li) => within(li).getAllByRole("link")[0]?.textContent?.trim())).toEqual(
      NAV_ORDER,
    );

    // Every row navigates somewhere (the logo is a separate Home link outside
    // the list), so there is no row that looks like a destination but is not.
    const linkedRows = items.filter((li) => within(li).queryAllByRole("link").length > 0);
    expect(linkedRows).toHaveLength(NAV_ORDER.length);
  });

  it("lists every screen before a project is selected", async () => {
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
    // Projects itself, not on the way to Users: nothing asked for a screen.
    expect(router.state.resolvedLocation?.search).not.toHaveProperty("next");
    expect(await screen.findByRole("heading", { name: "Projects" })).toBeInTheDocument();
    // Projects is the list the switcher would offer, with its own search, so
    // the bar carries no pill there (D21).
    await screen.findByRole("navigation", { name: "Context" });
    expect(screen.queryByRole("button", { name: "Switch project" })).not.toBeInTheDocument();

    // The project's screens are listed before one is chosen (D22).
    const nav = within(screen.getByRole("navigation", { name: "Primary" }));
    expect(nav.queryAllByRole("link").map((link) => link.textContent?.trim())).toEqual(NAV_ORDER);
    expect(nav.getByRole("link", { name: "Projects" })).toHaveAttribute("data-active", "true");
  });

  it("asks for a project on the way to a screen, then goes on there", async () => {
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

    const nav = within(screen.getByRole("navigation", { name: "Primary" }));
    await userEvent.click(nav.getByRole("link", { name: "Teams" }));

    // Teams needs a project, so the guard sends it to Projects, which names
    // the screen it is the way to; the sidebar marks Teams, as Vercel does.
    // Teams' own default filter rides along (`?status=active`).
    await waitFor(() => expect(router.state.resolvedLocation?.search.next).toMatch(/^\/teams\b/));
    expect(await screen.findByRole("heading", { name: "Continue to Teams" })).toBeInTheDocument();
    expect(screen.getByText("Choose a project to continue.")).toBeInTheDocument();
    expect(nav.getByRole("link", { name: "Teams" })).toHaveAttribute("data-active", "true");
    expect(nav.getByRole("link", { name: "Projects" })).toHaveAttribute("data-active", "false");

    await userEvent.click(await screen.findByRole("link", { name: "Delta" }));
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/teams"));
    expect(router.state.resolvedLocation?.search).toMatchObject({ project: "proj_2" });
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
    // The person heads the menu and opens their profile in account settings.
    // The selection rides along, so `Back to dashboard` returns to the same
    // project.
    expect(screen.getByRole("menuitem", { name: /^Test User/ })).toHaveAttribute(
      "href",
      scopedPath("/settings/profile", "proj_1"),
    );
    // Settings' own pages are not repeated beside it.
    expect(screen.queryByRole("menuitem", { name: "Profile" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Test account" })).not.toBeInTheDocument();
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
 * The footer names the signed-in person — by name over their email once a name
 * is set, else by email alone — and the sidebar's
 * header carries the one collapse toggle, beside the logo.
 */
describe("sidebar chrome", () => {
  it("leads the footer with the person's name, their email beneath", async () => {
    renderShell();
    const account = await screen.findByRole("button", { name: "Account: Test User" });
    expect(account).toHaveTextContent("Test User");
    expect(account).toHaveTextContent("test.user@example.com");
  });

  it("shows the email alone while the person has no name", async () => {
    const session = makeTestSession();
    vi.mocked(fetchSession).mockResolvedValue({
      ...session,
      user: { ...session.user, display: undefined },
    } as typeof session);
    try {
      renderShell();
      const account = await screen.findByRole("button", {
        name: "Account: test.user@example.com",
      });
      // No account line: accounts are not surfaced (Console ADR 0005 §3).
      expect(account).toHaveTextContent(/^test\.user@example\.com$/);
    } finally {
      vi.mocked(fetchSession).mockImplementation(async () => makeTestSession());
    }
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

  it("adds a team from beneath the list and opens it", async () => {
    const created: unknown[] = [];
    server.use(
      http.post(TEAMS_QUERY, () => HttpResponse.json({ teams: TEAMS })),
      http.get("*/api/teams/:teamId", ({ params }) =>
        HttpResponse.json(
          TEAMS.find((team) => team.id === params.teamId) ?? {
            ...TEAMS[0],
            id: "team_new",
            name: "Acme Labs",
          },
        ),
      ),
      http.post("*/api/teams", async ({ request }) => {
        created.push(await request.json());
        return HttpResponse.json({ ...TEAMS[0], id: "team_new", name: "Acme Labs" });
      }),
    );
    const router = renderShell(scopedPath("/teams/team_a", "proj_1"));
    const switcher = await screen.findByRole("button", { name: "Switch team" });
    await waitFor(() => expect(switcher).toHaveTextContent("Acme Inc"));

    await userEvent.click(switcher);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "All teams" })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Add team" }));

    // The popover closes; the drawer opens in its place.
    expect(screen.queryByRole("list", { name: "Switch team" })).not.toBeInTheDocument();
    await userEvent.type(await screen.findByLabelText("Team name"), "Acme Labs");
    await userEvent.click(screen.getByRole("button", { name: "Add team" }));

    expect(created).toEqual([{ name: "Acme Labs" }]);
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/teams/team_new"));
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
 *
 * Its list is a combobox: a search field over the selected project, the ones
 * opened recently and, while all of them fit on the first page, the rest by
 * name, with Projects beneath.
 */
describe("project pill", () => {
  /** Where `makeTestSession`'s person keeps their recent projects. */
  const RECENT_KEY = "zitadel.console.recent-projects:user_test";

  /** Each row as "name · what tells it apart", in the list's order. */
  function rows(container: HTMLElement): string[] {
    return within(container)
      .getAllByRole("option")
      .map((option) => {
        const [name, detail] = Array.from(
          option.querySelectorAll("span span"),
          (span) => span.textContent,
        );
        return detail ? `${name} · ${detail}` : (option.textContent ?? "");
      });
  }

  /** Opens the list from the pill once it names `name`. */
  async function openList(name: string) {
    const pill = await screen.findByRole("button", { name: "Switch project" });
    await waitFor(() => expect(pill).toHaveTextContent(name));
    await userEvent.click(pill);
    return { pill, list: await screen.findByRole("listbox", { name: "Projects" }) };
  }

  const RIVER_AND_DELTA = () =>
    HttpResponse.json({
      projects: [
        { id: "proj_1", name: "River" },
        { id: "proj_2", name: "Delta" },
      ],
    });

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

  it("opens on a search field above the selected project, the rest by name, and Projects", async () => {
    server.use(
      http.get(MY_PROJECTS, () =>
        HttpResponse.json({
          projects: [
            { id: "proj_1", name: "River" },
            { id: "proj_2", name: "Delta" },
            { id: "proj_3", name: "alpha" },
          ],
        }),
      ),
    );
    renderShell(scopedPath("/teams", "proj_2"));

    const { pill, list } = await openList("Delta");
    expect(pill).not.toHaveTextContent("River");
    // The popover opens on the field, so typing searches at once, however few
    // projects there are.
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Find a project" })).toHaveFocus(),
    );
    expect(rows(within(list).getByRole("group", { name: "Recent" }))).toEqual(["Delta · proj_2"]);
    // By name, in any case, rather than in the order the server keeps them.
    expect(rows(within(list).getByRole("group", { name: "Projects" }))).toEqual([
      "alpha · proj_3",
      "River · proj_1",
    ]);
    expect(within(list).getByRole("option", { name: "All projects" })).toBeInTheDocument();
  });

  it("lists the projects opened recently after the selected one, while they are still there", async () => {
    localStorage.setItem(
      RECENT_KEY,
      JSON.stringify([
        { id: "proj_3", name: "alpha" },
        // Deleted, or no longer theirs: the full list does not hold it.
        { id: "proj_9", name: "Gone" },
      ]),
    );
    server.use(
      http.get(MY_PROJECTS, () =>
        HttpResponse.json({
          projects: [
            { id: "proj_1", name: "River" },
            { id: "proj_2", name: "Delta" },
            { id: "proj_3", name: "alpha" },
          ],
        }),
      ),
    );
    renderShell(scopedPath("/teams", "proj_2"));

    const { list } = await openList("Delta");
    expect(rows(within(list).getByRole("group", { name: "Recent" }))).toEqual([
      "Delta · proj_2",
      "alpha · proj_3",
    ]);
    expect(rows(within(list).getByRole("group", { name: "Projects" }))).toEqual(["River · proj_1"]);
  });

  it("opens on the selected and recent projects alone once they run past one page", async () => {
    localStorage.setItem(
      RECENT_KEY,
      JSON.stringify([{ id: "proj_9", name: "Zephyr", host: "zephyr.example.com" }]),
    );
    server.use(
      http.get(MY_PROJECTS, () =>
        HttpResponse.json({
          projects: [
            { id: "proj_1", name: "River" },
            { id: "proj_2", name: "Delta" },
          ],
          next_page_token: "page-2",
        }),
      ),
    );
    renderShell(scopedPath("/teams", "proj_2"));

    const { list } = await openList("Delta");
    // The first page is only the oldest projects: listing it would say nothing.
    expect(rows(list)).toEqual(["Delta · proj_2", "Zephyr · zephyr.example.com", "All projects"]);
  });

  it("tells projects of one name apart by their site's host, or else their id", async () => {
    server.use(
      http.get(MY_PROJECTS, () =>
        HttpResponse.json({
          projects: [
            { id: "proj_1", name: "River" },
            {
              id: "proj_a",
              name: "maxtest1",
              origins: [
                // The local machine, which many projects list for development.
                { pattern: "http://localhost:5174", kind: "primary" },
                { pattern: "https://*-max.vercel.app", kind: "preview" },
                { pattern: "https://shop.example.com", kind: "primary" },
              ],
            },
            // A preview pattern names no one host, and loopback no site.
            {
              id: "proj_b",
              name: "maxtest1",
              origins: [
                { pattern: "https://*-max.vercel.app", kind: "preview" },
                { pattern: "http://127.0.0.1:3000", kind: "primary" },
              ],
            },
          ],
        }),
      ),
    );
    renderShell(scopedPath("/teams", "proj_1"));

    const { list } = await openList("River");
    expect(rows(within(list).getByRole("group", { name: "Projects" }))).toEqual([
      "maxtest1 · shop.example.com",
      "maxtest1 · proj_b",
    ]);
  });

  it("remembers the projects opened, most recent first, for the person signed in", async () => {
    server.use(http.get(MY_PROJECTS, RIVER_AND_DELTA));
    renderShell(scopedPath("/teams", "proj_1"));

    const { list } = await openList("River");
    await userEvent.click(within(list).getByRole("option", { name: /^Delta/ }));

    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]")).toEqual([
        { id: "proj_2", name: "Delta" },
        { id: "proj_1", name: "River" },
      ]),
    );
  });

  it("forgets a recent project once opening it is refused", async () => {
    localStorage.setItem(
      RECENT_KEY,
      JSON.stringify([
        { id: "proj_9", name: "Gone" },
        { id: "proj_1", name: "River" },
      ]),
    );
    server.use(
      http.get(MY_PROJECTS, () =>
        HttpResponse.json({
          projects: [{ id: "proj_1", name: "River" }],
          next_page_token: "page-2",
        }),
      ),
      http.get("*/api/projects/proj_9", () =>
        HttpResponse.json({ message: "project not found" }, { status: 404 }),
      ),
      http.get(HEALTH, () => HttpResponse.json({ status: "ok" })),
    );
    renderShell(scopedPath("/system", "proj_9"));

    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]")).toEqual([
        { id: "proj_1", name: "River" },
      ]),
    );
  });

  it("keeps the list's filters when switching project", async () => {
    server.use(http.get(MY_PROJECTS, RIVER_AND_DELTA));
    const router = renderShell(scopedPath("/teams?status=deactivated&q=ops", "proj_2"));

    const { list } = await openList("Delta");
    await userEvent.click(within(list).getByRole("option", { name: /^River/ }));

    await waitFor(() =>
      expect(router.state.resolvedLocation?.search).toMatchObject({
        project: "proj_1",
        status: "deactivated",
        q: "ops",
      }),
    );
    expect(router.state.resolvedLocation?.pathname).toBe("/teams");
  });

  it("re-scopes the screen and closes the list when a project is chosen", async () => {
    const queried: string[] = [];
    server.use(
      http.get(MY_PROJECTS, RIVER_AND_DELTA),
      http.post(TEAMS_QUERY, ({ request }) => {
        queried.push(new URL(request.url).searchParams.get("project_id") ?? "");
        return HttpResponse.json({ teams: [] });
      }),
    );
    const router = renderShell(scopedPath("/teams", "proj_1"));

    const { pill, list } = await openList("River");
    await userEvent.click(within(list).getByRole("option", { name: /^Delta/ }));

    await waitFor(() =>
      expect(router.state.resolvedLocation?.search).toMatchObject({ project: "proj_2" }),
    );
    expect(router.state.resolvedLocation?.pathname).toBe("/teams");
    await waitFor(() => expect(pill).toHaveTextContent("Delta"));
    expect(screen.queryByRole("listbox", { name: "Projects" })).not.toBeInTheDocument();
    await waitFor(() => expect(queried).toEqual(["proj_1", "proj_2"]));
  });

  it("lands on the new project's first screen when chosen from an unscoped one", async () => {
    server.use(
      http.get(MY_PROJECTS, RIVER_AND_DELTA),
      // System is the portal screen that needs no project.
      http.get(HEALTH, () => HttpResponse.json({ status: "ok" })),
    );
    const router = renderShell(scopedPath("/system", "proj_1"));

    const { list } = await openList("River");
    await userEvent.click(within(list).getByRole("option", { name: /^Delta/ }));

    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/users"));
    expect(router.state.resolvedLocation?.search).toMatchObject({ project: "proj_2" });
  });

  it("chooses the first match with Enter", async () => {
    server.use(
      http.get(MY_PROJECTS, ({ request }) => {
        const term = new URL(request.url).searchParams.get("name_contains")?.toLowerCase();
        const projects = [
          { id: "proj_1", name: "River" },
          { id: "proj_2", name: "Delta" },
        ];
        return HttpResponse.json({
          projects: term
            ? projects.filter((project) => project.name.toLowerCase().includes(term))
            : projects,
        });
      }),
    );
    const router = renderShell(scopedPath("/teams", "proj_1"));

    const { list } = await openList("River");
    await userEvent.keyboard("del");
    await waitFor(() => expect(rows(list)).toEqual(["Delta · proj_2", "All projects"]));
    await userEvent.keyboard("{Enter}");

    await waitFor(() =>
      expect(router.state.resolvedLocation?.search).toMatchObject({ project: "proj_2" }),
    );
  });

  it("searches every project on the server, past the first page", async () => {
    const searched: string[] = [];
    server.use(
      http.get(MY_PROJECTS, ({ request }) => {
        const nameContains = new URL(request.url).searchParams.get("name_contains");
        if (nameContains === null) {
          return HttpResponse.json({
            projects: [
              { id: "proj_1", name: "River" },
              { id: "proj_2", name: "Delta" },
            ],
            next_page_token: "page-2",
          });
        }
        searched.push(nameContains);
        // Past the first page, where only the server can find it.
        return HttpResponse.json({ projects: [{ id: "proj_9", name: "Zephyr" }] });
      }),
      // Chosen, it is named by reading it: it is not on the first page.
      http.get("*/api/projects/proj_9", () => HttpResponse.json({ id: "proj_9", name: "Zephyr" })),
    );
    const router = renderShell(scopedPath("/teams", "proj_2"));

    const { pill, list } = await openList("Delta");
    await userEvent.keyboard("zep");

    const zephyr = await within(list).findByRole("option", { name: /^Zephyr/ });
    expect(within(list).queryByRole("option", { name: /^River/ })).not.toBeInTheDocument();
    // One request per pause in typing, not per keystroke.
    expect(searched).toEqual(["zep"]);
    // The pill names the selection, never a match.
    expect(pill).toHaveTextContent("Delta");

    // The match the server sent is what Enter picks, though it landed after
    // the typing, while Projects was the only row to highlight.
    await waitFor(() => expect(zephyr).toHaveAttribute("aria-selected", "true"));
    await userEvent.keyboard("{Enter}");
    await waitFor(() =>
      expect(router.state.resolvedLocation?.search).toMatchObject({ project: "proj_9" }),
    );
    await waitFor(() => expect(pill).toHaveTextContent("Zephyr"));
  });

  it("says when a search finds nothing, and starts over when reopened", async () => {
    server.use(
      http.get(MY_PROJECTS, ({ request }) =>
        HttpResponse.json(
          new URL(request.url).searchParams.has("name_contains")
            ? { projects: [] }
            : { projects: [{ id: "proj_1", name: "River" }], next_page_token: "page-2" },
        ),
      ),
      http.get(HEALTH, () => HttpResponse.json({ status: "ok" })),
    );
    renderShell(scopedPath("/system", "proj_1"));

    const { pill, list } = await openList("River");
    await userEvent.keyboard("zzz");
    expect(await within(list).findByText("No matching projects")).toBeInTheDocument();
    // Projects stays beneath: a search that finds nothing is not a dead end.
    expect(within(list).getByRole("option", { name: "All projects" })).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("listbox", { name: "Projects" })).not.toBeInTheDocument(),
    );
    await userEvent.click(pill);
    expect(await screen.findByRole("combobox", { name: "Find a project" })).toHaveValue("");
    expect(
      await within(screen.getByRole("listbox", { name: "Projects" })).findByRole("option", {
        name: /^River/,
      }),
    ).toBeInTheDocument();
  });

  it("opens Projects from beneath the list", async () => {
    const router = renderShell(scopedPath("/teams", "proj_1"));

    const { list } = await openList("console-dev");
    await userEvent.click(within(list).getByRole("option", { name: "All projects" }));

    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/projects"));
    expect(screen.queryByRole("listbox", { name: "Projects" })).not.toBeInTheDocument();
  });

  it("says there are no projects instead of loading forever", async () => {
    server.use(
      http.get(MY_PROJECTS, () => HttpResponse.json({ projects: [] })),
      http.get(HEALTH, () => HttpResponse.json({ status: "ok" })),
    );
    // System, which reads no list of its own, so the pill is all that answers.
    renderShell("/system");

    const { list } = await openList("No projects");
    expect(within(list).getByText("No projects")).toBeInTheDocument();
  });

  it("falls back to the same empty state when the query fails", async () => {
    // The chrome is not worth an error boundary: a failed read degrades to the
    // empty pill rather than taking every screen down with it. The Projects
    // screen reads the same list and does report the failure; that is expected.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      server.use(
        http.get(MY_PROJECTS, () => new HttpResponse(null, { status: 500 })),
        http.get(HEALTH, () => HttpResponse.json({ status: "ok" })),
      );
      renderShell("/system");

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
 * palette over pages, teams found by name, projects and your settings.
 */
describe("search", () => {
  it("opens from the bar and goes to a page", async () => {
    const router = renderShell();
    await userEvent.click(await screen.findByRole("button", { name: "Search" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Go to" }));

    await userEvent.type(dialog.getByPlaceholderText("Go to a page, project or team"), "tea");
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

  it("toggles once for a held shortcut, and not over another open dialog or confirmation", async () => {
    renderShell();
    await screen.findByRole("link", { name: /^Users/ });
    // A held key: one press, then auto-repeats. It opens once and stays open.
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true, repeat: true });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true, repeat: true });
    expect(await screen.findByRole("dialog", { name: "Go to" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Go to" })).not.toBeInTheDocument(),
    );

    // Another dialog or a confirmation open: the shortcut leaves it alone.
    for (const role of ["dialog", "alertdialog"]) {
      const other = document.createElement("div");
      other.setAttribute("role", role);
      other.dataset.state = "open";
      document.body.append(other);
      try {
        fireEvent.keyDown(window, { key: "k", ctrlKey: true });
        expect(screen.queryByRole("dialog", { name: "Go to" })).not.toBeInTheDocument();
      } finally {
        other.remove();
      }
    }
  });

  it("drops a team the typing has ruled out before the next read lands", async () => {
    server.use(
      http.post(TEAMS_QUERY, async ({ request }) => {
        const body = (await request.json()) as { filter?: { field: string; value: string }[] };
        const name = body.filter?.find((f) => f.field === "name")?.value;
        // The answer for "ma"; the one for "mar" never lands in this test.
        if (name === "ma") {
          return HttpResponse.json({
            teams: [
              { id: "team_m", name: "Mainframe", status: "active", created_at: "", updated_at: "" },
            ],
          });
        }
        return new Promise(() => {});
      }),
    );
    renderShell();
    await userEvent.click(await screen.findByRole("button", { name: "Search" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Go to" }));
    const input = dialog.getByPlaceholderText("Go to a page, project or team");

    await userEvent.type(input, "ma");
    expect(await dialog.findByRole("option", { name: /Mainframe/ })).toBeInTheDocument();
    await userEvent.type(input, "r");
    await waitFor(() =>
      expect(dialog.queryByRole("option", { name: /Mainframe/ })).not.toBeInTheDocument(),
    );
  });

  it("finds your settings by the Settings sidebar's name for them", async () => {
    const router = renderShell();
    await userEvent.click(await screen.findByRole("button", { name: "Search" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Go to" }));

    await userEvent.type(dialog.getByPlaceholderText("Go to a page, project or team"), "sett");
    await userEvent.click(await dialog.findByRole("option", { name: "Settings" }));

    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/settings/profile"));
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
    await userEvent.type(dialog.getByPlaceholderText("Go to a page, project or team"), "sup");

    await userEvent.click(await dialog.findByRole("option", { name: /Support/ }));
    expect(filter).toContainEqual({ field: "name", operation: "contains", value: "sup" });
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/teams/team_s"));
  });

  it("finds projects by name on the server and selects one", async () => {
    const searched: string[] = [];
    server.use(
      http.get(MY_PROJECTS, ({ request }) => {
        const nameContains = new URL(request.url).searchParams.get("name_contains");
        if (nameContains === null) {
          return HttpResponse.json({
            projects: [{ id: "proj_1", name: "console-dev" }],
            next_page_token: "page-2",
          });
        }
        searched.push(nameContains);
        // Not on the first page the palette holds: only the server finds it.
        return HttpResponse.json({ projects: [{ id: "proj_9", name: "Zephyr" }] });
      }),
      // Off the first page, the pill names the selection by reading it.
      http.get("*/api/projects/proj_9", () =>
        HttpResponse.json({
          id: "proj_9",
          name: "Zephyr",
          origins: [],
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        }),
      ),
    );
    const router = renderShell(scopedPath("/users", "proj_1"));
    await userEvent.click(await screen.findByRole("button", { name: "Search" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Go to" }));
    await userEvent.type(dialog.getByPlaceholderText("Go to a page, project or team"), "zep");

    await userEvent.click(await dialog.findByRole("option", { name: "Zephyr" }));
    expect(searched).toEqual(["zep"]);
    await waitFor(() =>
      expect(router.state.resolvedLocation?.search).toMatchObject({ project: "proj_9" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Switch project" })).toHaveTextContent("Zephyr"),
    );
    // The palette names it too, though it is not on the first page.
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(
      await within(await screen.findByRole("dialog", { name: "Go to" })).findByText(
        "Pages in Zephyr",
      ),
    ).toBeInTheDocument();
  });

  it("keeps listing projects while a search is on its way", async () => {
    let answer: (() => void) | undefined;
    server.use(
      http.get(MY_PROJECTS, async ({ request }) => {
        if (!new URL(request.url).searchParams.has("name_contains")) {
          return HttpResponse.json({ projects: [{ id: "proj_1", name: "console-dev" }] });
        }
        await new Promise<void>((resolve) => {
          answer = resolve;
        });
        return HttpResponse.json({ projects: [{ id: "proj_9", name: "Zephyr" }] });
      }),
    );
    renderShell(scopedPath("/users", "proj_1"));
    await userEvent.click(await screen.findByRole("button", { name: "Search" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Go to" }));
    await dialog.findByRole("option", { name: "console-dev" });

    // Through the pause in typing and the request, the group keeps what it
    // showed instead of emptying.
    await userEvent.type(dialog.getByPlaceholderText("Go to a page, project or team"), "zep");
    expect(dialog.getByRole("option", { name: "console-dev" })).toBeInTheDocument();
    await waitFor(() => expect(answer).toBeDefined());
    expect(dialog.getByRole("option", { name: "console-dev" })).toBeInTheDocument();

    answer?.();
    expect(await dialog.findByRole("option", { name: "Zephyr" })).toBeInTheDocument();
    expect(dialog.queryByRole("option", { name: "console-dev" })).not.toBeInTheDocument();
  });

  it("says when nothing matches", async () => {
    // The server finds no project by that name; the first page has one.
    server.use(
      http.get(MY_PROJECTS, ({ request }) =>
        HttpResponse.json({
          projects: new URL(request.url).searchParams.has("name_contains")
            ? []
            : [{ id: "proj_1", name: "console-dev" }],
        }),
      ),
    );
    renderShell();
    await userEvent.click(await screen.findByRole("button", { name: "Search" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Go to" }));
    await userEvent.type(dialog.getByPlaceholderText("Go to a page, project or team"), "zzzz");
    expect(await dialog.findByText("Nothing matches “zzzz”")).toBeInTheDocument();
  });
});
