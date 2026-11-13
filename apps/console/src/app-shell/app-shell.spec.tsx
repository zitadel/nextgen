import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Receipt } from "lucide-react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { fetchSession } from "@/auth/session";
import { makeTestSession } from "@/test/session.fixture";
import { scopedPath } from "@/test/project-scope.fixture";

import { MOBILE_QUERY } from "@/hooks/use-mobile";
import { DOCS_URL } from "@/lib/docs";
import { THEME_STORAGE_KEY } from "@/theme";
import { createAppRouter } from "@/router";
import { server } from "@/test/msw";
import { _setRuntimeForTesting } from "@/runtime/runtime";

// The `_authed` layout guards every screen behind `GET /sessions/me`
// (Console ADR 0003); mock the auth module so routes render as signed in.
vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  const { makeTestSession } = await import("@/test/session.fixture");
  return { ...actual, fetchSession: vi.fn(async () => makeTestSession()) };
});

// An add-on with one Settings page, as the hosted cloud's has Billing, Support
// and Email: the console's own build has none, and then no Settings row (D42).
vi.mock("@/addon", () => ({
  addon: {
    screens: [
      {
        path: "/settings/invoices",
        nav: { label: "Invoices", view: "settings", order: 2, icon: Receipt },
        Screen: () => <h1>Invoices</h1>,
      },
    ],
    signedOutScreens: [],
  },
}));

/**
 * The sidebar lists only screens that exist. Entries come from `staticData.nav`
 * on the route tree (Console ADR 0001) and every one is a link.
 *
 * Guards against `aria-disabled` rows for unbuilt screens. Also covers the
 * theme toggle writing `data-theme` and persisting the preference.
 */
// The design's single-level sidebar ("01 / Nav Level 1"), less the screens
// that are not built (Sessions). Projects is not a row here: it heads the
// other list, the account's.
const NAV_ORDER = [
  "Overview",
  "Teams",
  "Users",
  "User schemas",
  "Login flows",
  "Branding",
  "Deployments",
  "Authentication",
  "Events",
  "Settings",
];
// The root's list (D42) for someone who holds nothing on the platform project:
// Projects, the spine, then Settings. No project's screens: those are reached
// by choosing the project.
const ACCOUNT_ORDER = ["Projects", "Settings"];
// And for someone who may act on the platform project, the root: its screens
// are a project's own, between the two. Overview is left out (the root's home
// is Projects) and its Settings pages join the root's Settings list.
const PLATFORM_ROOT_ORDER = [
  "Projects",
  "Teams",
  "Users",
  "User schemas",
  "Login flows",
  "Branding",
  "Deployments",
  "Authentication",
  "Events",
  "Settings",
];
// Settings' list: the heading that leads back, then what the add-on adds. The
// profile is the account menu's, so it is not here.
const SETTINGS_ORDER = ["Settings", "Invoices"];
// For someone who may act on the platform project, its own Settings pages
// come first: that project is the root (D42).
const PLATFORM_SETTINGS_ORDER = ["Settings", "General", "Admins", "Invitations", "Invoices"];
// The project's Settings list (D40): the heading that leads back, then its pages.
const PROJECT_SETTINGS_ORDER = ["Settings", "General", "Admins", "Invitations"];
// Absent for two different reasons, both deliberate:
//   - the first four have no endpoint at all
//   - Sessions was built, but `POST /sessions/query` answers 501 (#699)
const NEVER_SHOWN = ["App groups", "Applications", "Analytics", "Activity Log", "Sessions"];

// `GET /users/me/projects` is the authorized-projects query (#1228): what the
// signed-in person can act on, read with the session cookie.
const MY_PROJECTS = "*/api/v1/users/me/projects";
// System, the portal screen that needs no project, reads the server's readiness.
const READY = "*/api/v1/readyz";
// Users is where most tests go once a project is selected.
const USERS_QUERY = "*/api/v1/users/query";
// Some tests open on Teams to prove a switch keeps the screen.
const TEAMS_QUERY = "*/api/v1/teams/query";
// `/settings` lands on the profile, which reads the signed-in person's own record.
const MY_USER = "*/api/v1/users/me";
// The reserved platform project (D42): the console signs in to it. Whether its
// read answers says whether the person may act on it.
const PLATFORM = "*/api/v1/projects/proj_platform";

/** Makes the signed-in person someone who may act on the platform project. */
function actsOnPlatform() {
  server.use(
    http.get(PLATFORM, () =>
      HttpResponse.json({
        id: "proj_platform",
        name: "Platform",
        origins: [],
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        owning_team_id: null,
      }),
    ),
  );
}

// What the palette asks once something is typed: users, then the other types.
const SEARCH = "*/api/v1/search";
interface SearchBody {
  query: string;
  types: string[];
  limit_per_type: number;
}
// Events reads the project's events, and Overview its newest few.
const EVENTS = "*/api/v1/events";
// Overview reads the selected project and what its primary origins serve.
const PROJECT_1 = "*/api/v1/projects/proj_1";
const DEPLOYMENTS = "*/api/v1/deployments";
beforeEach(() => {
  // The switcher's recent projects live in localStorage: none carry over.
  localStorage.clear();
  _setRuntimeForTesting({
    mode: "standalone",
    console_project_id: "proj_platform",
    publishable_key: "pk_platform",
    platform_project_id: "proj_platform",
  });
  server.use(
    // The person holds nothing on the platform project, as a cloud customer
    // does: its read is refused, so the root is Projects and Settings.
    // `actsOnPlatform` makes them someone who may act on it.
    http.get(PLATFORM, () =>
      HttpResponse.json({ code: "proj.not_found", message: "Not found" }, { status: 404 }),
    ),
    http.get(MY_PROJECTS, () =>
      HttpResponse.json({ projects: [{ id: "proj_1", name: "console-dev" }] }),
    ),
    http.get(MY_USER, () =>
      HttpResponse.json({ id: "user_1", attributes: { email: "dev@zitadel.local" } }),
    ),
    http.post(USERS_QUERY, () => HttpResponse.json({ users: [] })),
    http.post(TEAMS_QUERY, () => HttpResponse.json({ teams: [] })),
    http.post(SEARCH, () => HttpResponse.json({ results: [], incomplete_types: [] })),
    // `/` is the project's Overview (D35): the project, what is live, and its
    // newest events. Only the listed project: a selection the list does not
    // carry is a test's own to answer.
    http.get(PROJECT_1, () =>
      HttpResponse.json({
        id: "proj_1",
        name: "console-dev",
        origins: [],
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        owning_team_id: null,
      }),
    ),
    http.get(DEPLOYMENTS, () => HttpResponse.json({ deployments: [] })),
    http.get(EVENTS, () => HttpResponse.json({ data: [] })),
  );
});

/** Where `makeTestSession`'s person keeps their recent projects. */
const RECENT_KEY = "zitadel.console.recent-projects:user_test";

/** Each row as "name · the line beneath it", in the list's order. */
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

  it("marks with an arrow the rows that swap the list for their own", async () => {
    renderShell();
    await screen.findByRole("link", { name: /^Users/ });
    const nav = within(screen.getByRole("navigation", { name: "Primary" }));

    // Events opens Events' list, and the project's Settings its own (D40), as
    // Settings does above every project.
    const arrowed = nav
      .getAllByRole("link")
      .filter((link) => link.querySelector("[data-opens-list]"))
      .map((link) => link.textContent?.trim());
    expect(arrowed).toEqual(["Events", "Settings"]);
  });

  it("draws the home, Projects, in the frame every screen has", async () => {
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

    // One frame for every screen (D27). Above every project the sidebar lists
    // the root's screens, and the pill says so rather than naming one.
    const nav = within(screen.getByRole("navigation", { name: "Account" }));
    await waitFor(() =>
      expect(nav.getAllByRole("link").map((link) => link.textContent?.trim())).toEqual(
        ACCOUNT_ORDER,
      ),
    );
    expect(nav.getByRole("link", { name: "Projects" })).toHaveAttribute("data-active", "true");
    // One row for Settings: its pages are its own list's, not repeated here.
    expect(nav.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
    // It opens a list of its own, and says so with an arrow.
    expect(
      nav
        .getAllByRole("link")
        .filter((link) => link.querySelector("[data-opens-list]"))
        .map((link) => link.textContent?.trim()),
    ).toEqual(["Settings"]);
    expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch project" })).toHaveTextContent(
      "All projects",
    );
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/projects");
    // Search heads the sidebar, not the bar, where it would sit a row above
    // the list's own search.
    const sidebar = within(document.querySelector('[data-slot="sidebar"]') as HTMLElement);
    expect(sidebar.getByRole("button", { name: "Search" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Search" })).toHaveLength(1);
    expect(screen.getByRole("searchbox", { name: "Search projects" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^Account:/ }));
    expect(await screen.findByRole("menuitem", { name: "Log out" })).toBeInTheDocument();
  });

  it("links the documentation from the account menu, in a new tab", async () => {
    renderShell();
    await userEvent.click(await screen.findByRole("button", { name: /^Account:/ }));
    const docs = await screen.findByRole("menuitem", { name: "Documentation" });
    expect(docs).toHaveAttribute("href", DOCS_URL);
    expect(docs).toHaveAttribute("target", "_blank");
    // Last but one, above Log out.
    const items = screen.getAllByRole("menuitem").map((item) => item.textContent);
    expect(items.slice(-2)).toEqual(["Documentation", "Log out"]);
    expect(screen.getByRole("menu")).toHaveAttribute("data-side", "right");
  });

  it("opens the account menu above its row on a phone, where the sidebar is a sheet", async () => {
    const matchMedia = window.matchMedia;
    const phone = vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      ...matchMedia(query),
      matches: query === MOBILE_QUERY,
    }));
    onTestFinished(() => phone.mockRestore());
    renderShell();
    // On a phone the sidebar, and the account row in it, is a sheet opened from the bar.
    await screen.findByRole("button", { name: "Search" });
    // The first is the toggle beside the logo; the second, shadcn's edge rail.
    const [toggle] = screen.getAllByRole("button", { name: "Toggle Sidebar" });
    await userEvent.click(toggle as HTMLElement);
    await userEvent.click(await screen.findByRole("button", { name: /^Account:/ }));
    // The side asked for; that the menu then fits a 375px screen is a layout
    // fact jsdom cannot measure.
    expect(await screen.findByRole("menu")).toHaveAttribute("data-side", "top");
  });

  it("lists every screen before a project is selected", async () => {
    server.use(
      http.get(MY_PROJECTS, () =>
        HttpResponse.json({
          projects: [
            { id: "proj_1", name: "River" },
            { id: "proj_2", name: "Delta" },
          ],
        }),
      ),
      http.get(READY, () => HttpResponse.text("ok")),
    );
    // System needs no project, so it opens with none selected.
    renderShell("/system");

    // The project's screens are listed before one is chosen (D22).
    const nav = within(await screen.findByRole("navigation", { name: "Primary" }));
    expect(nav.queryAllByRole("link").map((link) => link.textContent?.trim())).toEqual(NAV_ORDER);
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
      http.get(READY, () => HttpResponse.text("ok")),
    );
    const router = renderShell("/system");

    const nav = within(await screen.findByRole("navigation", { name: "Primary" }));
    await userEvent.click(nav.getByRole("link", { name: "Teams" }));

    // Teams needs a project, so the guard sends it to Projects, which names
    // the screen it is the way to. Teams' own default filter rides along
    // (`?status=active`).
    await waitFor(() => expect(router.state.resolvedLocation?.search.next).toMatch(/^\/teams\b/));
    expect(await screen.findByRole("heading", { name: "Continue to Teams" })).toBeInTheDocument();
    // The root's list holds no row for a project's screen (D42), so Projects,
    // the page that asks, is the marked one.
    expect(
      within(screen.getByRole("navigation", { name: "Account" })).getByRole("link", {
        name: "Projects",
      }),
    ).toHaveAttribute("data-active", "true");

    await userEvent.click(await screen.findByRole("link", { name: "Delta" }));
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/teams"));
    expect(router.state.resolvedLocation?.search).toMatchObject({ project: "proj_2" });
    // Inside a project, the sidebar lists its screens again.
    expect(await screen.findByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  });

  // The reserved platform project is the root's, for someone who may act on
  // it (D42). Anyone else is never in it: a URL that names it goes on without.
  it("drops a selection of the platform project for someone who may not act on it", async () => {
    const router = renderShell("/users?project=proj_platform");

    // Their only project is selected instead, as for any project they cannot choose.
    await waitFor(() =>
      expect(router.state.resolvedLocation?.search).toMatchObject({ project: "proj_1" }),
    );
    expect(router.state.resolvedLocation?.pathname).toBe("/users");
    expect(await screen.findByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch project" })).toHaveTextContent("console-dev");
  });

  it("goes home to Projects from the logo", async () => {
    const router = renderShell();
    await screen.findByRole("link", { name: /^Users/ });

    await userEvent.click(screen.getByRole("link", { name: "Home" }));
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/projects"));
    // Projects is the root's, so it holds the root, not the project left
    // behind (D44): for someone who may not act on the platform, no selection.
    // The bar names that root, their projects alone, and no project before it.
    expect(router.state.resolvedLocation?.search).not.toHaveProperty("project");
    const bar = within(screen.getByRole("navigation", { name: "Context" }));
    const pill = bar.getByRole("button", { name: "Switch project" });
    await waitFor(() => expect(pill).toHaveTextContent("All projects"));
    expect(pill).not.toHaveTextContent("console-dev");
    expect(bar.queryByRole("link", { name: "All projects" })).not.toBeInTheDocument();
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
 * The sidebar has three lists and the route picks between them, so a settings
 * URL restores Settings' list rather than dropping the operator back into the
 * project's. The account list's Settings row and the account dropdown are the
 * ways in; the list's heading leads back up, and the project pill back into a
 * project (D29).
 */
// The reserved platform project is the root (D42): for someone who may act on
// it, its screens are the root's, drawn like any project's with that project
// selected, and never offered as a project to choose.
describe("platform root", () => {
  beforeEach(actsOnPlatform);

  it("lists the platform project's screens at the root, each selecting it", async () => {
    const router = renderShell("/projects");
    const nav = within(await screen.findByRole("navigation", { name: "Account" }));
    await waitFor(() =>
      expect(nav.getAllByRole("link").map((link) => link.textContent?.trim())).toEqual(
        PLATFORM_ROOT_ORDER,
      ),
    );
    // A project's own screens, under a project's names, for the platform project.
    expect(nav.getByRole("link", { name: "Users" })).toHaveAttribute(
      "href",
      scopedPath("/users", "proj_platform"),
    );
    expect(nav.getByRole("link", { name: "Deployments" })).toHaveAttribute(
      "href",
      scopedPath("/deployments", "proj_platform"),
    );
    // The root's own screens hold the platform too (D44): Projects is opened
    // with it selected, not the one project, and so are its rows.
    await waitFor(() =>
      expect(router.state.resolvedLocation?.search).toMatchObject({ project: "proj_platform" }),
    );
    expect(nav.getByRole("link", { name: "Projects" })).toHaveAttribute(
      "href",
      scopedPath("/projects", "proj_platform"),
    );
    // The bar names the root, the platform, whose screen this is (D44).
    const pill = screen.getByRole("button", { name: "Switch project" });
    await waitFor(() => expect(pill).toHaveTextContent("Platform"));
    expect(pill).not.toHaveTextContent("console-dev");
    // None of the platform's rows is marked while the screen is not its own.
    expect(nav.getByRole("link", { name: "Projects" })).toHaveAttribute("data-active", "true");
    expect(nav.getByRole("link", { name: "Users" })).toHaveAttribute("data-active", "false");

    await userEvent.click(nav.getByRole("link", { name: "Users" }));
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/users"));
    expect(router.state.resolvedLocation?.search).toMatchObject({ project: "proj_platform" });
    // Still the root's list, with the screen marked, and never a project's.
    const root = within(await screen.findByRole("navigation", { name: "Account" }));
    expect(root.getByRole("link", { name: "Users" })).toHaveAttribute("data-active", "true");
    expect(root.getByRole("link", { name: "Projects" })).toHaveAttribute("data-active", "false");
    expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();
    // The bar says the root, the platform, and no project beside it (D44).
    await waitFor(() => expect(pill).toHaveTextContent("Platform"));
    expect(
      within(screen.getByRole("navigation", { name: "Context" })).getAllByRole("button"),
    ).toHaveLength(1);
  });

  it("offers the platform apart from the projects, checked at the root, never as a recent one", async () => {
    // A browser that kept the platform project as a recent one, as before D42.
    localStorage.setItem(
      RECENT_KEY,
      JSON.stringify([
        { id: "proj_platform", name: "Platform" },
        { id: "proj_1", name: "console-dev" },
      ]),
    );
    const router = renderShell("/users?project=proj_platform");
    const pill = await screen.findByRole("button", { name: "Switch project" });
    await waitFor(() => expect(pill).toHaveTextContent("Platform"));

    await userEvent.click(pill);
    const list = within(await screen.findByRole("listbox"));
    // Its own section, first, and the row the pill stands for.
    const own = within(await list.findByRole("group", { name: "Platform" }));
    const row = own.getByRole("option", { name: /^Platform/ });
    expect(row.querySelector(".lucide-check")).not.toBeNull();
    // The projects follow, none of them it, and none checked.
    const recent = within(list.getByRole("group", { name: "Recent" }));
    expect(recent.getAllByRole("option").map((option) => option.textContent)).toEqual([
      expect.stringContaining("console-dev"),
    ]);
    expect(recent.getByRole("option").querySelector(".lucide-check")).toBeNull();
    expect(list.getAllByRole("option", { name: /Platform/ })).toHaveLength(1);

    // Choosing a project keeps the screen, now the project's, under the root.
    await userEvent.click(recent.getByRole("option", { name: /console-dev/ }));
    await waitFor(() =>
      expect(router.state.resolvedLocation?.search).toMatchObject({ project: "proj_1" }),
    );
    expect(router.state.resolvedLocation?.pathname).toBe("/users");
    expect(await screen.findByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    // Opened from the root, it is remembered; the platform never is.
    expect(JSON.stringify({ ...localStorage })).toContain("proj_1");
    await waitFor(() => expect(JSON.stringify({ ...localStorage })).not.toContain("proj_platform"));
  });

  it("heads a project with the root in the bar, the way back up", async () => {
    const router = renderShell(scopedPath("/users", "proj_1"));
    const bar = within(await screen.findByRole("navigation", { name: "Context" }));
    // Platform / console-dev, as Vercel's bar reads team / project (D44).
    const up = await bar.findByRole("link", { name: "Platform" });
    await waitFor(() =>
      expect(bar.getByRole("button", { name: "Switch project" })).toHaveTextContent("console-dev"),
    );

    // The pill's list checks the project, not the platform.
    await userEvent.click(bar.getByRole("button", { name: "Switch project" }));
    const list = within(await screen.findByRole("listbox"));
    const project = await list.findByRole("option", { name: /console-dev/ });
    expect(project.querySelector(".lucide-check")).not.toBeNull();
    const platform = list.getByRole("option", { name: /^Platform/ });
    expect(platform.querySelector(".lucide-check")).toBeNull();

    // Choosing the platform keeps the screen: the root has Users too.
    await userEvent.click(platform);
    await waitFor(() =>
      expect(router.state.resolvedLocation?.search).toMatchObject({ project: "proj_platform" }),
    );
    expect(router.state.resolvedLocation?.pathname).toBe("/users");
    expect(await screen.findByRole("navigation", { name: "Account" })).toBeInTheDocument();
    expect(bar.queryByRole("link", { name: "Platform" })).not.toBeInTheDocument();

    expect(up).not.toBeInTheDocument();

    // And back in the project, the root's crumb opens Projects, the root's home.
    await userEvent.click(bar.getByRole("button", { name: "Switch project" }));
    await userEvent.click(
      await within(await screen.findByRole("listbox")).findByRole("option", {
        name: /console-dev/,
      }),
    );
    await userEvent.click(await bar.findByRole("link", { name: "Platform" }));
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/projects"));
    await waitFor(() =>
      expect(bar.getByRole("button", { name: "Switch project" })).toHaveTextContent("Platform"),
    );
  });

  it("opens Projects when the platform is chosen where the root has no such screen", async () => {
    // A project's Overview: the root has none, its home is Projects (D42).
    const router = renderShell(scopedPath("/", "proj_1"));
    const pill = await screen.findByRole("button", { name: "Switch project" });
    await waitFor(() => expect(pill).toHaveTextContent("console-dev"));
    await userEvent.click(pill);
    await userEvent.click(
      await within(await screen.findByRole("listbox")).findByRole("option", {
        name: /^Platform/,
      }),
    );
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/projects"));
    // The platform is the selection then, not the project left behind.
    expect(router.state.resolvedLocation?.search).toMatchObject({ project: "proj_platform" });
    await waitFor(() => expect(pill).toHaveTextContent("Platform"));
  });

  it("lists the platform project's Settings pages in the root's Settings, before the add-on's", async () => {
    renderShell("/settings/invoices");
    const nav = within(await screen.findByRole("navigation", { name: "Settings" }));
    await waitFor(() =>
      expect(nav.getAllByRole("link").map((link) => link.textContent?.trim())).toEqual(
        PLATFORM_SETTINGS_ORDER,
      ),
    );
    expect(nav.getByRole("link", { name: "General" })).toHaveAttribute(
      "href",
      scopedPath("/project/general", "proj_platform"),
    );
    expect(nav.getByRole("link", { name: "Admins" })).toHaveAttribute(
      "href",
      scopedPath("/project/admins", "proj_platform"),
    );
    expect(nav.getByRole("link", { name: "Settings: back to Projects" })).toBeInTheDocument();
  });

  it("draws the platform project's Settings pages under the root's Settings list", async () => {
    server.use(
      http.get("*/api/v1/variables", () => HttpResponse.json({ variables: [] })),
      http.get("*/api/v1/projects/proj_platform/admins", () => HttpResponse.json({ admins: [] })),
      http.post("*/api/v1/grants/query", () => HttpResponse.json({ grants: [] })),
    );
    renderShell("/project/admins?project=proj_platform");

    // Not the project's Settings list, whose heading leads back to a project.
    const nav = within(await screen.findByRole("navigation", { name: "Settings" }));
    await waitFor(() =>
      expect(nav.getAllByRole("link").map((link) => link.textContent?.trim())).toEqual(
        PLATFORM_SETTINGS_ORDER,
      ),
    );
    expect(nav.getByRole("link", { name: "Admins" })).toHaveAttribute("data-active", "true");
    expect(screen.queryByRole("navigation", { name: "Project settings" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch project" })).toHaveTextContent("Platform");
  });

  it("opens the platform project's Events under a heading that leads back to Projects", async () => {
    renderShell("/events?project=proj_platform");
    const nav = within(await screen.findByRole("navigation", { name: "Events" }));
    expect(nav.getByRole("link", { name: "Events: back to Projects" })).toHaveAttribute(
      "href",
      scopedPath("/projects", "proj_platform"),
    );
    expect(nav.getByRole("button", { name: "View: Audit events" })).toBeInTheDocument();
  });

  it("finds the root's screens in search as above every project, never in a project named Platform", async () => {
    renderShell("/users?project=proj_platform");
    await userEvent.click(await screen.findByRole("button", { name: "Search" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Go to" }));
    // Before anything is typed, the root's screens are the root's, named the
    // platform as the bar names it (D44), and no group names it as a project.
    const root = within(await dialog.findByRole("group", { name: "Platform" }));
    expect(await root.findByRole("option", { name: "Teams" })).toBeInTheDocument();
    expect(dialog.queryByRole("group", { name: /Pages in/ })).not.toBeInTheDocument();

    await userEvent.type(
      dialog.getByPlaceholderText("Go to a page, user, team or project, or run an action"),
      "deploy",
    );
    await waitFor(() =>
      expect(rows(dialog.getByRole("listbox"))).toEqual(["Deployments · Platform"]),
    );
  });

  it("lists the root's screens beside the selected project's in search", async () => {
    renderShell(scopedPath("/users", "proj_1"));
    await userEvent.click(await screen.findByRole("button", { name: "Search" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Go to" }));
    await userEvent.type(
      dialog.getByPlaceholderText("Go to a page, user, team or project, or run an action"),
      "deploy",
    );
    // The project's first, then the root's, each saying where it is.
    await waitFor(() =>
      expect(rows(dialog.getByRole("listbox"))).toEqual([
        "Deployments · console-dev",
        "Deployments · Platform",
      ]),
    );
  });

  // Its hits read as the root's screen that lists them, and opening one
  // selects the platform project, as opening any hit selects its project.
  it("reads a hit in the platform project as the root's and opens it there", async () => {
    const platformUser = {
      id: "user_p",
      schema: "sch_platform",
      identifier: "ada@zitadel.example",
      identifier_property: "email",
      attributes: { email: "ada@zitadel.example" },
      metadata: { status: "active", created_at: "2026-07-12T09:00:00Z" },
    };
    server.use(
      http.post(SEARCH, async ({ request }) => {
        const body = (await request.json()) as SearchBody;
        const hits = [
          {
            type: "user",
            id: "user_p",
            project_id: "proj_platform",
            title: "Ada Admin",
            subtitle: "ada@zitadel.example",
          },
          {
            type: "user",
            id: "user_1",
            project_id: "proj_1",
            title: "Ada Lovelace",
            subtitle: "ada@acme.example",
          },
          { type: "team", id: "team_p", project_id: "proj_platform", title: "Ada's team" },
        ];
        return HttpResponse.json({
          // Whichever types the palette asks for, together or apart.
          results: hits.filter((hit) => body.types.includes(hit.type)),
          incomplete_types: [],
          more_projects: false,
        });
      }),
      http.get("*/api/v1/users/user_p", () => HttpResponse.json(platformUser)),
      http.get("*/api/v1/schemas/sch_platform", () =>
        HttpResponse.json({ id: "sch_platform", schema: { title: "Platform user" } }),
      ),
      http.get("*/api/v1/users/user_p/passkeys", () => HttpResponse.json({ passkeys: [] })),
      http.get("*/api/v1/users/user_p/identity_links", () =>
        HttpResponse.json({ identity_links: [] }),
      ),
      http.get("*/api/v1/users/user_p/password", () => HttpResponse.json({})),
    );
    const router = renderShell("/projects");
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/projects"));
    await userEvent.click(await screen.findByRole("button", { name: "Search" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Go to" }));
    await userEvent.type(
      dialog.getByPlaceholderText("Go to a page, user, team or project, or run an action"),
      "ada",
    );

    // Projects holds the platform (D44), so its hits come first among equal
    // matches, as the selected project's do (D39).
    await waitFor(() =>
      expect(rows(dialog.getByRole("listbox"))).toEqual([
        "Ada Admin · ada@zitadel.example · Users",
        "Ada's team · Teams",
        "Ada Lovelace · ada@acme.example · console-dev",
      ]),
    );
    expect(dialog.queryByRole("option", { name: /Platform/ })).not.toBeInTheDocument();

    await userEvent.click(dialog.getByRole("option", { name: /^Ada Admin/ }));
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/users/user_p"));
    expect(router.state.resolvedLocation?.search).toMatchObject({ project: "proj_platform" });
    expect(screen.getByRole("button", { name: "Switch project" })).toHaveTextContent("Platform");
  });
});

describe("settings view", () => {
  it("shows the project's list and the account dropdown's entry point by default", async () => {
    renderShell();
    await screen.findByRole("link", { name: /^Users/ });
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^Account:/ }));
    expect(await screen.findByRole("menuitem", { name: "Log out" })).toBeInTheDocument();
    // The person heads the menu and opens their profile, apart from the root
    // Settings (D42). The profile is the root's, so it holds the root, not
    // the project (D44).
    expect(screen.getByRole("menuitem", { name: /^Test User/ })).toHaveAttribute(
      "href",
      "/account",
    );
    // Settings' own pages are not repeated beside it.
    expect(screen.queryByRole("menuitem", { name: "Profile" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Test account" })).not.toBeInTheDocument();
  });

  it("swaps the project's list for Settings' on a settings URL", async () => {
    renderShell("/settings/invoices");
    const nav = within(await screen.findByRole("navigation", { name: "Settings" }));
    await waitFor(() =>
      expect(nav.getAllByRole("link").map((link) => link.textContent?.trim())).toEqual(
        SETTINGS_ORDER,
      ),
    );
    expect(nav.getByRole("link", { name: "Invoices" })).toHaveAttribute("data-active", "true");
    // A row of the list it is already in opens no other.
    expect(
      nav.getByRole("link", { name: "Invoices" }).querySelector("[data-opens-list]"),
    ).toBeNull();
    // The project's list and the account's are gone rather than sitting
    // underneath it.
    expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Account" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Users/ })).not.toBeInTheDocument();
  });

  it("goes back up to the account's list from the Settings heading", async () => {
    const router = renderShell("/settings/invoices");
    const nav = within(await screen.findByRole("navigation", { name: "Settings" }));
    // A row of the left nav (D13), named for where it leads. Settings holds
    // the root, no project, even with one to choose (D44), and so does Projects.
    const heading = nav.getByRole("link", { name: "Settings: back to Projects" });
    expect(heading).toHaveAttribute("href", "/projects");

    await userEvent.click(heading);
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/projects"));
    const account = within(await screen.findByRole("navigation", { name: "Account" }));
    expect(account.getAllByRole("link").map((link) => link.textContent?.trim())).toEqual(
      ACCOUNT_ORDER,
    );
  });

  it("keeps the bar in Settings, its pill on the root", async () => {
    const router = renderShell("/settings/invoices");
    await screen.findByRole("navigation", { name: "Settings" });

    expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument();
    expect(document.querySelector('[data-sidebar="trigger"]')).toBeInTheDocument();
    // Settings is the root's: it holds no project, and the pill names the
    // root (D44); its list leads into the project.
    const pill = screen.getByRole("button", { name: "Switch project" });
    await waitFor(() => expect(pill).toHaveTextContent("All projects"));
    expect(router.state.resolvedLocation?.search).not.toHaveProperty("project");

    await userEvent.click(pill);
    const list = within(await screen.findByRole("listbox", { name: "Projects" }));
    await userEvent.click(await list.findByRole("option", { name: /^console-dev/ }));

    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/"));
    expect(router.state.resolvedLocation?.search).toMatchObject({ project: "proj_1" });
    await waitFor(() => expect(pill).toHaveTextContent("console-dev"));
  });
});

/**
 * Events swaps the project's list for its own, as Settings does: the views and
 * the filters of that one screen, under a heading that leads back to the
 * project's screens (D30). Events is inside a project, so the pill still names
 * it.
 */
describe("events view", () => {
  beforeEach(() => {
    server.use(
      http.get(EVENTS, () => HttpResponse.json({ data: [] })),
      http.get(`${EVENTS}/evt_1`, () =>
        HttpResponse.json({
          id: "evt_1",
          project_id: "proj_1",
          event_type: "user.deleted",
          category: "entity",
          occurred_at: "2026-11-10T08:15:43Z",
          created_at: "2026-11-10T08:15:43Z",
          client_id: "",
          payload: {},
        }),
      ),
    );
  });

  it("opens Events' list from the project's Events row", async () => {
    const router = renderShell();
    const primary = within(await screen.findByRole("navigation", { name: "Primary" }));

    await userEvent.click(primary.getByRole("link", { name: "Events" }));

    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/events"));
    expect(await screen.findByRole("navigation", { name: "Events" })).toBeInTheDocument();
  });

  it("swaps the project's list for Events' on an events URL", async () => {
    renderShell("/events");
    const nav = within(await screen.findByRole("navigation", { name: "Events" }));
    // The heading back, then the view, chosen from a menu as Vercel's is.
    expect(nav.getAllByRole("link").map((link) => link.textContent?.trim())).toEqual(["Events"]);
    expect(nav.getByRole("button", { name: "View: Audit events" })).toBeInTheDocument();
    // The list's filters follow the view, in a group of their own.
    expect(screen.getByRole("group", { name: "Filters" })).toBeInTheDocument();
    // The project's list is gone rather than sitting underneath it.
    expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Users/ })).not.toBeInTheDocument();
  });

  it("keeps Events' list on an event's page", async () => {
    renderShell("/events/evt_1");
    expect(await screen.findByRole("heading", { name: "user.deleted" })).toBeInTheDocument();
    const nav = within(screen.getByRole("navigation", { name: "Events" }));
    expect(nav.getByRole("button", { name: "View: Audit events" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();
  });

  it("goes back up to the project's list from the Events heading", async () => {
    const router = renderShell("/events");
    const nav = within(await screen.findByRole("navigation", { name: "Events" }));
    // A row of the left nav (D13), named for where it leads: the project's
    // landing screen, whichever that is.
    const heading = nav.getByRole("link", { name: "Events: back to the project" });
    expect(heading).toHaveAttribute("href", scopedPath("/", "proj_1"));

    await userEvent.click(heading);
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/"));
    const primary = within(await screen.findByRole("navigation", { name: "Primary" }));
    expect(
      primary.getAllByRole("listitem").map((li) => within(li).getAllByRole("link")[0]?.textContent),
    ).toEqual(NAV_ORDER);
    // Events' filters leave with its list.
    expect(screen.queryByRole("group", { name: "Filters" })).not.toBeInTheDocument();
  });

  it("slides Events' list in from the right, and the project's back in from the left", async () => {
    renderShell();
    const primary = await screen.findByRole("navigation", { name: "Primary" });
    // The first list drawn stays still.
    expect(primary.parentElement).not.toHaveClass("animate-in");

    await userEvent.click(within(primary).getByRole("link", { name: "Events" }));
    const list = await screen.findByRole("navigation", { name: "Events" });
    expect(list.parentElement).toHaveClass("animate-in", "slide-in-from-right-4");

    await userEvent.click(within(list).getByRole("link", { name: "Events: back to the project" }));
    const back = await screen.findByRole("navigation", { name: "Primary" });
    expect(back.parentElement).toHaveClass("animate-in", "slide-in-from-left-4");
  });

  it("keeps the pill on the project, which Events is inside", async () => {
    renderShell("/events");
    await screen.findByRole("navigation", { name: "Events" });

    const pill = screen.getByRole("button", { name: "Switch project" });
    await waitFor(() => expect(pill).toHaveTextContent("console-dev"));
    expect(pill).not.toHaveTextContent("All projects");
  });

  it("finds Events among the project's pages in search, from its own list too", async () => {
    renderShell("/events");
    await screen.findByRole("navigation", { name: "Events" });

    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Go to" }));
    // The way to any other screen without going back up first.
    const pages = within(await dialog.findByRole("group", { name: "Pages in console-dev" }));
    expect(pages.getByRole("option", { name: "Teams" })).toBeInTheDocument();
    expect(pages.getByRole("option", { name: "Events" })).toBeInTheDocument();
  });
});

/**
 * A project's Settings swaps the project's list for its own, as the root
 * Settings swaps the account's (D29, D40): its pages, General and Admins,
 * under a heading that leads back to the project. The root's Settings list
 * other pages, an add-on's; both open the same way.
 */
describe("project settings view", () => {
  beforeEach(() => {
    server.use(
      http.get(`${PROJECT_1}/admins`, () => HttpResponse.json({ admins: [] })),
      http.post("*/api/v1/grants/query", () => HttpResponse.json({ grants: [] })),
      http.get("*/api/v1/variables", () => HttpResponse.json({})),
    );
  });

  it("opens the project's Settings list from its Settings row, on General", async () => {
    const router = renderShell();
    const primary = within(await screen.findByRole("navigation", { name: "Primary" }));

    await userEvent.click(primary.getByRole("link", { name: "Settings" }));

    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/project/general"));
    const nav = within(await screen.findByRole("navigation", { name: "Project settings" }));
    expect(nav.getAllByRole("link").map((link) => link.textContent?.trim())).toEqual(
      PROJECT_SETTINGS_ORDER,
    );
    expect(nav.getByRole("link", { name: "General" })).toHaveAttribute("data-active", "true");
    // A row of the list it is already in opens no other.
    expect(nav.getByRole("link", { name: "Admins" }).querySelector("[data-opens-list]")).toBeNull();
    // The project's list is gone rather than sitting underneath it.
    expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();
  });

  it("keeps the project's header while moving between its pages", async () => {
    const router = renderShell(scopedPath("/project/general", "proj_1"));
    const nav = within(await screen.findByRole("navigation", { name: "Project settings" }));
    expect(await screen.findByLabelText("Project name")).toBeInTheDocument();

    await userEvent.click(nav.getByRole("link", { name: "Admins" }));

    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/project/admins"));
    expect(await screen.findByRole("region", { name: "Admins" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "console-dev" })).toBeInTheDocument();
    expect(nav.getByRole("link", { name: "Admins" })).toHaveAttribute("data-active", "true");
    expect(screen.queryByLabelText("Project name")).not.toBeInTheDocument();
  });

  it("goes back up to the project's list from the Settings heading", async () => {
    const router = renderShell(scopedPath("/project/admins", "proj_1"));
    const nav = within(await screen.findByRole("navigation", { name: "Project settings" }));
    // Named for where it leads, as Events' heading is: the project's landing.
    const heading = nav.getByRole("link", { name: "Settings: back to the project" });
    expect(heading).toHaveAttribute("href", scopedPath("/", "proj_1"));

    await userEvent.click(heading);
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/"));
    const primary = within(await screen.findByRole("navigation", { name: "Primary" }));
    expect(
      primary.getAllByRole("listitem").map((li) => within(li).getAllByRole("link")[0]?.textContent),
    ).toEqual(NAV_ORDER);
  });

  it("keeps the pill on the project whose Settings these are", async () => {
    renderShell(scopedPath("/project/general", "proj_1"));
    await screen.findByRole("navigation", { name: "Project settings" });

    const pill = screen.getByRole("button", { name: "Switch project" });
    await waitFor(() => expect(pill).toHaveTextContent("console-dev"));
    expect(pill).not.toHaveTextContent("All projects");
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
      http.get("*/api/v1/teams/:teamId", ({ params }) =>
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
      http.get("*/api/v1/teams/:teamId", ({ params }) =>
        HttpResponse.json(
          TEAMS.find((team) => team.id === params.teamId) ?? {
            ...TEAMS[0],
            id: "team_new",
            name: "Acme Labs",
          },
        ),
      ),
      http.post("*/api/v1/teams", async ({ request }) => {
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
    const drawer = await screen.findByRole("dialog", { name: "Add team" });
    await userEvent.type(within(drawer).getByLabelText("Team name"), "Acme Labs");
    await userEvent.click(within(drawer).getByRole("button", { name: "Add team" }));

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
    // The bar carries the switchers only; the theme lives with the person.
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
    renderShell("/users");

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
      http.get("*/api/v1/projects/proj_9", () =>
        HttpResponse.json({ message: "project not found" }, { status: 404 }),
      ),
      http.get(READY, () => HttpResponse.text("ok")),
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

  it("lands on the new project's Overview when chosen from an unscoped one", async () => {
    server.use(
      http.get(MY_PROJECTS, RIVER_AND_DELTA),
      // System is the portal screen that needs no project.
      http.get(READY, () => HttpResponse.text("ok")),
      // Delta's Overview reads it.
      http.get("*/api/v1/projects/proj_2", () =>
        HttpResponse.json({
          id: "proj_2",
          name: "Delta",
          origins: [],
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
          owning_team_id: null,
        }),
      ),
    );
    const router = renderShell(scopedPath("/system", "proj_1"));

    const { list } = await openList("River");
    await userEvent.click(within(list).getByRole("option", { name: /^Delta/ }));

    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/"));
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
      http.get("*/api/v1/projects/proj_9", () =>
        HttpResponse.json({ id: "proj_9", name: "Zephyr" }),
      ),
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
      http.get(READY, () => HttpResponse.text("ok")),
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
      http.get(READY, () => HttpResponse.text("ok")),
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
        http.get(READY, () => HttpResponse.text("ok")),
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
 * Search moves you somewhere: the sidebar's field (or ⌘K / Ctrl K) opens a "Go to"
 * palette. Before anything is typed it is a menu in groups; once something is,
 * one list, best match first, each row saying beneath its name where it is
 * (D37).
 */
describe("search", () => {
  it("opens from the sidebar and goes to a page", async () => {
    const router = renderShell();
    await userEvent.click(await screen.findByRole("button", { name: "Search" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Go to" }));

    await userEvent.type(
      dialog.getByPlaceholderText("Go to a page, user, team or project, or run an action"),
      "tea",
    );
    await userEvent.click(await dialog.findByRole("option", { name: /^Teams/ }));

    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/teams"));
    expect(screen.queryByRole("dialog", { name: "Go to" })).not.toBeInTheDocument();
  });

  it("toggles with the keyboard shortcut, in Settings too", async () => {
    renderShell("/settings/invoices");
    await screen.findByRole("navigation", { name: "Settings" });
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
      http.post(SEARCH, async ({ request }) => {
        const body = (await request.json()) as SearchBody;
        // The answer for "ma"; the one for "mar" never lands in this test.
        if (body.query === "ma") {
          return HttpResponse.json({
            results: [{ type: "team", id: "team_m", project_id: "proj_1", title: "Mainframe" }],
            incomplete_types: [],
          });
        }
        return new Promise(() => {});
      }),
    );
    renderShell();
    await userEvent.click(await screen.findByRole("button", { name: "Search" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Go to" }));
    const input = dialog.getByPlaceholderText(
      "Go to a page, user, team or project, or run an action",
    );

    await userEvent.type(input, "ma");
    expect(await dialog.findByRole("option", { name: /Mainframe/ })).toBeInTheDocument();
    await userEvent.type(input, "r");
    await waitFor(() =>
      expect(dialog.queryByRole("option", { name: /Mainframe/ })).not.toBeInTheDocument(),
    );
  });

  it("finds Settings' pages by their own name and by the list's", async () => {
    const router = renderShell();
    await userEvent.click(await screen.findByRole("button", { name: "Search" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Go to" }));
    const field = dialog.getByPlaceholderText(
      "Go to a page, user, team or project, or run an action",
    );

    // The Settings row is a list, not a page, so its pages stand in for it,
    // each marked with the list's name.
    await userEvent.type(field, "invo");
    expect(await dialog.findByRole("option", { name: /^Invoices/ })).toHaveTextContent("Settings");

    // The project's Settings is a list too (D40): its pages stand in for it,
    // marked Settings and then the project, which is what tells them apart
    // from the root's Settings page. The project's come first.
    await userEvent.clear(field);
    await userEvent.type(field, "sett");
    await waitFor(() =>
      expect(rows(dialog.getByRole("listbox"))).toEqual([
        "General · Settings · console-dev",
        "Admins · Settings · console-dev",
        "Invitations · Settings · console-dev",
        "Invoices · Settings",
      ]),
    );

    // Profile is the account's, apart from Settings (D42).
    await userEvent.clear(field);
    await userEvent.type(field, "prof");
    const profile = await dialog.findByRole("option", { name: /^Profile/ });
    expect(profile).toHaveTextContent("Account");
    expect(profile).not.toHaveTextContent("Settings");
    await userEvent.click(profile);

    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/account"));
  });

  it("finds teams on the server and opens one", async () => {
    const asked: SearchBody[] = [];
    server.use(
      http.post(SEARCH, async ({ request }) => {
        const body = (await request.json()) as SearchBody;
        asked.push(body);
        return HttpResponse.json({
          results: body.types.includes("team")
            ? [{ type: "team", id: "team_s", project_id: "proj_1", title: "Support" }]
            : [],
          incomplete_types: [],
        });
      }),
      http.get("*/api/v1/teams/team_s", () =>
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
    await userEvent.type(
      dialog.getByPlaceholderText("Go to a page, user, team or project, or run an action"),
      "sup",
    );

    await userEvent.click(await dialog.findByRole("option", { name: /Support/ }));
    // Users are asked for on their own, so the quick types do not wait for them.
    expect(asked).toContainEqual({ query: "sup", types: ["user"], limit_per_type: 5 });
    expect(asked).toContainEqual({
      query: "sup",
      types: ["team", "schema", "flow_definition", "idp"],
      limit_per_type: 5,
    });
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/teams/team_s"));
  });

  it("asks for users only once there is enough to match them by", async () => {
    const asked: SearchBody[] = [];
    server.use(
      http.post(SEARCH, async ({ request }) => {
        asked.push((await request.json()) as SearchBody);
        return HttpResponse.json({ results: [], incomplete_types: [] });
      }),
    );
    renderShell();
    await userEvent.click(await screen.findByRole("button", { name: "Search" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Go to" }));

    await userEvent.type(
      dialog.getByPlaceholderText("Go to a page, user, team or project, or run an action"),
      "an",
    );
    await waitFor(() => expect(asked).toHaveLength(1));
    expect(asked[0]?.types).not.toContain("user");
  });

  it("finds users by what the server matched, and hands a long list to Users", async () => {
    server.use(
      http.post(SEARCH, async ({ request }) => {
        const body = (await request.json()) as SearchBody;
        if (!body.types.includes("user")) {
          return HttpResponse.json({ results: [], incomplete_types: [] });
        }
        return HttpResponse.json({
          results: [
            {
              type: "user",
              id: "user_9",
              project_id: "proj_1",
              title: "Grace Hopper",
              subtitle: "grace@example.com",
            },
          ],
          incomplete_types: ["user"],
        });
      }),
    );
    const router = renderShell();
    await userEvent.click(await screen.findByRole("button", { name: "Search" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Go to" }));
    // The text is in the identifier, which the row shows under the name.
    await userEvent.type(
      dialog.getByPlaceholderText("Go to a page, user, team or project, or run an action"),
      "example",
    );

    // Beneath the name: the identifier, then the project the user is in.
    expect(await dialog.findByRole("option", { name: /Grace Hopper/ })).toHaveTextContent(
      "grace@example.com · console-dev",
    );
    await userEvent.click(dialog.getByRole("option", { name: /See all users matching/ }));
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/users"));
    expect(router.state.resolvedLocation?.search).toMatchObject({ q: "example" });
  });

  it("holds eight rows at most, the last opening Users when there are more", async () => {
    server.use(
      http.post(SEARCH, async ({ request }) => {
        const body = (await request.json()) as SearchBody;
        if (!body.types.includes("user")) {
          return HttpResponse.json({ results: [], incomplete_types: [] });
        }
        return HttpResponse.json({
          results: Array.from({ length: 8 }, (_, index) => ({
            type: "user",
            id: `user_${index}`,
            project_id: "proj_1",
            title: `Ann ${index}`,
          })),
          incomplete_types: ["user"],
        });
      }),
    );
    renderShell();
    await userEvent.click(await screen.findByRole("button", { name: "Search" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Go to" }));
    await userEvent.type(
      dialog.getByPlaceholderText("Go to a page, user, team or project, or run an action"),
      "ann",
    );

    // The row that opens Users takes the last place rather than a ninth.
    await waitFor(() =>
      expect(rows(dialog.getByRole("listbox"))).toEqual([
        ...Array.from({ length: 7 }, (_, index) => `Ann ${index} · console-dev`),
        "See all users matching “ann” · console-dev",
      ]),
    );
  });

  it("lists the configuration the server found, each with its second line", async () => {
    server.use(
      http.post(SEARCH, async ({ request }) => {
        const body = (await request.json()) as SearchBody;
        if (body.types.includes("user")) {
          return HttpResponse.json({ results: [], incomplete_types: [] });
        }
        return HttpResponse.json({
          results: [
            {
              type: "schema",
              id: "sch_1",
              project_id: "proj_1",
              title: "Partner Staff",
              subtitle: "partner-user",
            },
            {
              type: "flow_definition",
              id: "flowdef_1",
              project_id: "proj_1",
              title: "partner-sign-in",
              subtitle: "login",
            },
            {
              type: "idp",
              id: "idp_1",
              project_id: "proj_1",
              title: "Partner Portal",
              subtitle: "partner-sso",
            },
          ],
          incomplete_types: [],
        });
      }),
    );
    renderShell();
    await userEvent.click(await screen.findByRole("button", { name: "Search" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Go to" }));
    await userEvent.type(
      dialog.getByPlaceholderText("Go to a page, user, team or project, or run an action"),
      "partner",
    );

    expect(await dialog.findByRole("option", { name: /Partner Staff/ })).toHaveTextContent(
      "partner-user · console-dev",
    );
    expect(dialog.getByRole("option", { name: /partner-sign-in/ })).toHaveTextContent(
      "login · console-dev",
    );
    expect(dialog.getByRole("option", { name: /Partner Portal/ })).toHaveTextContent(
      "partner-sso · console-dev",
    );
  });

  it("opens the drawers its actions name, over the screen it was opened on", async () => {
    const router = renderShell(scopedPath("/users", "proj_1"));
    for (const action of ["Add team", "Add user"]) {
      await userEvent.click(await screen.findByRole("button", { name: "Search" }));
      const dialog = within(await screen.findByRole("dialog", { name: "Go to" }));
      await userEvent.type(
        dialog.getByPlaceholderText("Go to a page, user, team or project, or run an action"),
        "add",
      );

      await userEvent.click(await dialog.findByRole("option", { name: new RegExp(`^${action}`) }));

      // The palette makes way for the drawer, and the screen stays.
      const drawer = await screen.findByRole("dialog", { name: action });
      expect(screen.queryByRole("dialog", { name: "Go to" })).not.toBeInTheDocument();
      expect(router.state.resolvedLocation?.pathname).toBe("/users");
      await userEvent.click(within(drawer).getByRole("button", { name: "Cancel" }));
      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: action })).not.toBeInTheDocument(),
      );
    }
  });

  it("copies the selected project's id and says so", async () => {
    // `setup()` is what gives the page a clipboard to write to.
    const user = userEvent.setup();
    renderShell(scopedPath("/users", "proj_1"));
    await user.click(await screen.findByRole("button", { name: "Search" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Go to" }));
    await user.type(
      dialog.getByPlaceholderText("Go to a page, user, team or project, or run an action"),
      "copy",
    );

    await user.click(await dialog.findByRole("option", { name: /Copy project ID/ }));

    expect(await screen.findByText("Project ID copied")).toBeInTheDocument();
    // Read inside `waitFor`: the closed palette still settles its typing
    // pause, and a bare await here lets that update land outside act().
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe("proj_1"));
  });

  it("lists what was opened from it, until something is typed", async () => {
    server.use(
      http.post(SEARCH, async ({ request }) => {
        const body = (await request.json()) as SearchBody;
        return HttpResponse.json({
          results: body.types.includes("team")
            ? [{ type: "team", id: "team_s", project_id: "proj_1", title: "Support" }]
            : [],
          incomplete_types: [],
        });
      }),
      http.get("*/api/v1/teams/team_s", () =>
        HttpResponse.json({
          id: "team_s",
          name: "Support",
          status: "active",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        }),
      ),
    );
    const router = renderShell(scopedPath("/users", "proj_1"));
    await userEvent.click(await screen.findByRole("button", { name: "Search" }));
    let dialog = within(await screen.findByRole("dialog", { name: "Go to" }));
    // Nothing was opened yet.
    expect(dialog.queryByRole("group", { name: "Recent" })).not.toBeInTheDocument();
    await userEvent.type(
      dialog.getByPlaceholderText("Go to a page, user, team or project, or run an action"),
      "sup",
    );
    await userEvent.click(await dialog.findByRole("option", { name: /Support/ }));
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/teams/team_s"));

    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    dialog = within(await screen.findByRole("dialog", { name: "Go to" }));
    const recent = within(await dialog.findByRole("group", { name: "Recent" }));
    expect(recent.getByRole("option", { name: /Support/ })).toBeInTheDocument();

    await userEvent.type(
      dialog.getByPlaceholderText("Go to a page, user, team or project, or run an action"),
      "x",
    );
    expect(dialog.queryByRole("group", { name: "Recent" })).not.toBeInTheDocument();
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
      http.get("*/api/v1/projects/proj_9", () =>
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
    await userEvent.type(
      dialog.getByPlaceholderText("Go to a page, user, team or project, or run an action"),
      "zep",
    );

    await userEvent.click(await dialog.findByRole("option", { name: /^Zephyr/ }));
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

  it("keeps what the last answer found while the next is on its way, less what is ruled out", async () => {
    let answer: (() => void) | undefined;
    server.use(
      http.get(MY_PROJECTS, async ({ request }) => {
        const term = new URL(request.url).searchParams.get("name_contains");
        if (term === null) {
          return HttpResponse.json({ projects: [{ id: "proj_1", name: "console-dev" }] });
        }
        if (term === "ze") {
          return HttpResponse.json({
            projects: [
              { id: "proj_9", name: "Zephyr" },
              { id: "proj_8", name: "Zelda" },
            ],
          });
        }
        await new Promise<void>((resolve) => {
          answer = resolve;
        });
        return HttpResponse.json({
          projects: [
            { id: "proj_9", name: "Zephyr" },
            { id: "proj_7", name: "Zeppelin" },
          ],
        });
      }),
    );
    renderShell(scopedPath("/users", "proj_1"));
    await userEvent.click(await screen.findByRole("button", { name: "Search" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Go to" }));
    const field = dialog.getByPlaceholderText(
      "Go to a page, user, team or project, or run an action",
    );
    await userEvent.type(field, "ze");
    expect(await dialog.findByRole("option", { name: /^Zelda/ })).toBeInTheDocument();

    // Through the pause in typing and the request, the list keeps what still
    // matches instead of emptying.
    await userEvent.type(field, "p");
    expect(dialog.queryByRole("option", { name: /^Zelda/ })).not.toBeInTheDocument();
    expect(dialog.getByRole("option", { name: /^Zephyr/ })).toBeInTheDocument();
    await waitFor(() => expect(answer).toBeDefined());
    expect(dialog.getByRole("option", { name: /^Zephyr/ })).toBeInTheDocument();

    answer?.();
    expect(await dialog.findByRole("option", { name: /^Zeppelin/ })).toBeInTheDocument();
  });

  it("ranks every kind in one list, the project's first, each saying where it is", async () => {
    server.use(
      http.get(MY_PROJECTS, ({ request }) =>
        HttpResponse.json({
          projects: new URL(request.url).searchParams.has("name_contains")
            ? [
                {
                  id: "proj_7",
                  name: "Logbook",
                  origins: [{ pattern: "https://logbook.example.com", kind: "primary" }],
                },
              ]
            : [{ id: "proj_1", name: "console-dev" }],
        }),
      ),
      http.post(SEARCH, async ({ request }) => {
        const body = (await request.json()) as SearchBody;
        return HttpResponse.json({
          results: body.types.includes("user")
            ? [
                {
                  type: "user",
                  id: "user_1",
                  project_id: "proj_1",
                  title: "Jo Logan",
                  subtitle: "jo@example.com",
                },
              ]
            : [{ type: "team", id: "team_l", project_id: "proj_1", title: "Logistics" }],
          incomplete_types: [],
        });
      }),
    );
    renderShell(scopedPath("/users", "proj_1"));
    await userEvent.click(await screen.findByRole("button", { name: "Search" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Go to" }));
    await userEvent.type(
      dialog.getByPlaceholderText("Go to a page, user, team or project, or run an action"),
      "log",
    );

    // Names that start with the text before a word inside one; among those,
    // the project's pages, then its team, then the project of that name.
    await waitFor(() =>
      expect(rows(dialog.getByRole("listbox"))).toEqual([
        "Login flows · console-dev",
        "Logistics · console-dev",
        "Logbook · logbook.example.com",
        "Jo Logan · jo@example.com · console-dev",
      ]),
    );
    // One list, not a group per kind.
    expect(dialog.queryByRole("group", { name: "Users" })).not.toBeInTheDocument();
  });

  it("tells two projects of one name apart", async () => {
    server.use(
      http.get(MY_PROJECTS, ({ request }) =>
        HttpResponse.json({
          projects: new URL(request.url).searchParams.has("name_contains")
            ? [
                {
                  id: "proj_a",
                  name: "my_shop",
                  origins: [{ pattern: "https://shop.example.com", kind: "primary" }],
                },
                { id: "proj_b", name: "my_shop" },
              ]
            : [{ id: "proj_1", name: "console-dev" }],
        }),
      ),
    );
    renderShell(scopedPath("/users", "proj_1"));
    await userEvent.click(await screen.findByRole("button", { name: "Search" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Go to" }));
    await userEvent.type(
      dialog.getByPlaceholderText("Go to a page, user, team or project, or run an action"),
      "shop",
    );

    // As the switcher draws them (D21): the site's host, or else the id.
    await waitFor(() =>
      expect(rows(dialog.getByRole("listbox"))).toEqual([
        "my_shop · shop.example.com",
        "my_shop · proj_b",
      ]),
    );
  });

  it("opens on the selected and recent projects when one page does not hold them all", async () => {
    localStorage.setItem(RECENT_KEY, JSON.stringify([{ id: "proj_3", name: "Delta" }]));
    server.use(
      http.get(MY_PROJECTS, () =>
        HttpResponse.json({
          projects: [
            { id: "proj_1", name: "console-dev" },
            { id: "proj_2", name: "Alpha" },
            { id: "proj_3", name: "Delta" },
          ],
          next_page_token: "page-2",
        }),
      ),
    );
    renderShell(scopedPath("/users", "proj_1"));
    await userEvent.click(await screen.findByRole("button", { name: "Search" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Go to" }));

    // The first page is not the projects in use: those come first, then it.
    const projects = await dialog.findByRole("group", { name: "Projects" });
    expect(rows(projects)).toEqual(["console-dev · proj_1", "Delta · proj_3", "Alpha · proj_2"]);
  });

  it("opens on the first projects when none is selected or recent", async () => {
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
    const router = renderShell();
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/projects"));
    await userEvent.click(await screen.findByRole("button", { name: "Search" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Go to" }));

    // More projects than one page, nothing to put first: still not none.
    const projects = await dialog.findByRole("group", { name: "Projects" });
    expect(rows(projects)).toEqual(["River · proj_1", "Delta · proj_2"]);
  });

  it("says it is searching until the server has answered", async () => {
    // Users and the other types are asked for apart: two requests to hold.
    const answers: (() => void)[] = [];
    server.use(
      http.post(SEARCH, async () => {
        await new Promise<void>((resolve) => {
          answers.push(resolve);
        });
        return HttpResponse.json({ results: [], incomplete_types: [] });
      }),
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
    await userEvent.type(
      dialog.getByPlaceholderText("Go to a page, user, team or project, or run an action"),
      "zzzz",
    );

    // An empty list is not "nothing matches" while a search is on its way.
    await waitFor(() => expect(answers).toHaveLength(2));
    expect(dialog.getByText("Searching…")).toBeInTheDocument();
    expect(dialog.queryByText(/^Nothing in/)).not.toBeInTheDocument();

    for (const answer of answers) answer();
    expect(await dialog.findByText("Nothing in console-dev matches “zzzz”")).toBeInTheDocument();
  });

  it("puts projects before a project's pages while none is selected, and names the account", async () => {
    server.use(
      http.get(MY_PROJECTS, ({ request }) =>
        HttpResponse.json({
          projects: new URL(request.url).searchParams.has("name_contains")
            ? [{ id: "proj_7", name: "Logbook" }]
            : [
                { id: "proj_1", name: "River" },
                { id: "proj_2", name: "Delta" },
              ],
        }),
      ),
    );
    const router = renderShell();
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/projects"));
    await userEvent.click(await screen.findByRole("button", { name: "Search" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Go to" }));
    const field = dialog.getByPlaceholderText(
      "Go to a page, user, team or project, or run an action",
    );

    // A project opens at once; its pages ask for one first.
    await userEvent.type(field, "log");
    await waitFor(() =>
      expect(rows(dialog.getByRole("listbox"))).toEqual([
        "Logbook · proj_7",
        "Login flows · Choose a project",
      ]),
    );

    // The account's own row says where it is, as every typed row does.
    await userEvent.clear(field);
    await userEvent.type(field, "projects");
    await waitFor(() => expect(rows(dialog.getByRole("listbox"))).toContain("Projects · Account"));
  });

  it("says where it looked when nothing matches", async () => {
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
    await userEvent.type(
      dialog.getByPlaceholderText("Go to a page, user, team or project, or run an action"),
      "zzzz",
    );
    expect(await dialog.findByText("Nothing in console-dev matches “zzzz”")).toBeInTheDocument();
    expect(
      dialog.getByText("Users, teams and configuration are found in the selected project only."),
    ).toBeInTheDocument();
  });

  it("at All projects searches the person's projects, and says so when nothing matches", async () => {
    const asked: (string | null)[] = [];
    // Several to choose from, so `/` lands on Projects with nothing selected.
    server.use(
      http.get(MY_PROJECTS, ({ request }) =>
        HttpResponse.json({
          projects: new URL(request.url).searchParams.has("name_contains")
            ? []
            : [
                { id: "proj_1", name: "River" },
                { id: "proj_2", name: "Delta" },
              ],
        }),
      ),
      http.post(SEARCH, ({ request }) => {
        asked.push(new URL(request.url).searchParams.get("project_id"));
        return HttpResponse.json({ results: [], incomplete_types: [], more_projects: false });
      }),
    );
    const router = renderShell();
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/projects"));
    await userEvent.click(await screen.findByRole("button", { name: "Search" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Go to" }));
    const field = dialog.getByPlaceholderText(
      "Go to a page, user, team or project, or run an action",
    );

    // A project's page says that opening it asks for a project (D22).
    await userEvent.type(field, "users");
    await waitFor(() =>
      expect(rows(dialog.getByRole("listbox"))).toEqual(["Users · Choose a project"]),
    );

    // A person's name: no page is called that ("admin" would find the
    // project's Admins page), and the server finds nobody by it here.
    await userEvent.clear(field);
    await userEvent.type(field, "ada");
    expect(await dialog.findByText("Nothing matches “ada”")).toBeInTheDocument();
    expect(
      dialog.getByText("Searched users, teams and configuration in every project you can act on."),
    ).toBeInTheDocument();
    // No project named: the server reads the person's projects (D39).
    await waitFor(() => expect(asked.length).toBeGreaterThan(0));
    expect(asked.every((projectId) => projectId === null)).toBe(true);
  });

  it("at All projects says it read the newest ten of many projects", async () => {
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
      http.post(SEARCH, () =>
        HttpResponse.json({ results: [], incomplete_types: ["team"], more_projects: true }),
      ),
    );
    const router = renderShell();
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/projects"));
    await userEvent.click(await screen.findByRole("button", { name: "Search" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Go to" }));
    await userEvent.type(
      dialog.getByPlaceholderText("Go to a page, user, team or project, or run an action"),
      "qqqq",
    );

    expect(
      await dialog.findByText(
        "Searched users, teams and configuration in the newest ten of your projects. Choose a project to search the others.",
      ),
    ).toBeInTheDocument();
  });

  it("at All projects does not claim users were searched for text too short for them", async () => {
    server.use(
      http.get(MY_PROJECTS, () =>
        HttpResponse.json({
          projects: [
            { id: "proj_1", name: "River" },
            { id: "proj_2", name: "Delta" },
          ],
        }),
      ),
      http.post(SEARCH, () =>
        HttpResponse.json({ results: [], incomplete_types: [], more_projects: false }),
      ),
    );
    const router = renderShell();
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/projects"));
    await userEvent.click(await screen.findByRole("button", { name: "Search" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Go to" }));
    await userEvent.type(
      dialog.getByPlaceholderText("Go to a page, user, team or project, or run an action"),
      "qq",
    );

    expect(
      await dialog.findByText(
        "Searched teams and configuration in every project you can act on. Users are found from three characters.",
      ),
    ).toBeInTheDocument();
  });

  it("says beneath its matches that it read the newest ten of many projects", async () => {
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
      http.post(SEARCH, async ({ request }) => {
        const body = (await request.json()) as SearchBody;
        return HttpResponse.json({
          results: body.types.includes("team")
            ? [{ type: "team", id: "team_d", project_id: "proj_2", title: "Support" }]
            : [],
          incomplete_types: ["team"],
          more_projects: true,
        });
      }),
    );
    const router = renderShell();
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/projects"));
    await userEvent.click(await screen.findByRole("button", { name: "Search" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Go to" }));
    await userEvent.type(
      dialog.getByPlaceholderText("Go to a page, user, team or project, or run an action"),
      "supp",
    );

    expect(await dialog.findByRole("option", { name: /Delta/ })).toBeInTheDocument();
    expect(
      await dialog.findByText(
        "Searched users, teams and configuration in the newest ten of your projects. Choose a project to search the others.",
      ),
    ).toBeInTheDocument();
  });

  it("above every project searches all of them, none of them first", async () => {
    const asked: (string | null)[] = [];
    server.use(
      http.get(MY_PROJECTS, () =>
        HttpResponse.json({
          projects: [
            { id: "proj_1", name: "console-dev" },
            { id: "proj_2", name: "Delta" },
          ],
        }),
      ),
      http.post(SEARCH, async ({ request }) => {
        asked.push(new URL(request.url).searchParams.get("project_id"));
        const body = (await request.json()) as SearchBody;
        return HttpResponse.json({
          results: body.types.includes("team")
            ? [
                { type: "team", id: "team_d", project_id: "proj_2", title: "Support" },
                { type: "team", id: "team_c", project_id: "proj_1", title: "Support" },
              ]
            : [],
          incomplete_types: [],
          more_projects: false,
        });
      }),
    );
    // Projects, opened from console-dev: it holds the root, not the project (D44).
    renderShell(scopedPath("/projects", "proj_1"));
    await userEvent.click(await screen.findByRole("button", { name: "Search" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Go to" }));
    await userEvent.type(
      dialog.getByPlaceholderText("Go to a page, user, team or project, or run an action"),
      "supp",
    );

    // No project is selected there, so none ranks first: the server's order.
    await waitFor(() =>
      expect(rows(dialog.getByRole("listbox"))).toEqual([
        "Support · Delta",
        "Support · console-dev",
      ]),
    );
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((projectId) => projectId === null)).toBe(true);
  });

  it("across projects asks once per pause for every type", async () => {
    const asked: SearchBody[] = [];
    server.use(
      http.get(MY_PROJECTS, () =>
        HttpResponse.json({
          projects: [
            { id: "proj_1", name: "River" },
            { id: "proj_2", name: "Delta" },
          ],
        }),
      ),
      http.post(SEARCH, async ({ request }) => {
        asked.push((await request.json()) as SearchBody);
        return HttpResponse.json({ results: [], incomplete_types: [], more_projects: false });
      }),
    );
    const router = renderShell();
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/projects"));
    await userEvent.click(await screen.findByRole("button", { name: "Search" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Go to" }));
    const field = dialog.getByPlaceholderText(
      "Go to a page, user, team or project, or run an action",
    );

    // Too short for users: one request without them.
    await userEvent.type(field, "su");
    await waitFor(() => expect(asked).toHaveLength(1));
    expect(asked[0]?.types).toEqual(["team", "schema", "flow_definition", "idp"]);

    await userEvent.type(field, "pp");
    await waitFor(() => expect(asked).toHaveLength(2));
    expect(asked[1]?.types).toEqual(["user", "team", "schema", "flow_definition", "idp"]);
  });

  it("says more may match when a kind has more than the server read", async () => {
    server.use(
      http.post(SEARCH, async ({ request }) => {
        const body = (await request.json()) as SearchBody;
        if (!body.types.includes("team")) {
          return HttpResponse.json({ results: [], incomplete_types: [], more_projects: false });
        }
        return HttpResponse.json({
          results: [{ type: "team", id: "team_s", project_id: "proj_1", title: "Support" }],
          incomplete_types: ["team"],
          more_projects: false,
        });
      }),
    );
    renderShell(scopedPath("/teams", "proj_1"));
    await userEvent.click(await screen.findByRole("button", { name: "Search" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Go to" }));
    await userEvent.type(
      dialog.getByPlaceholderText("Go to a page, user, team or project, or run an action"),
      "supp",
    );

    expect(await dialog.findByRole("option", { name: /Support/ })).toBeInTheDocument();
    expect(
      await dialog.findByText("More may match. Type more to narrow it down."),
    ).toBeInTheDocument();
  });

  it("says more may match when a narrow grant saw none of what the server read", async () => {
    server.use(
      http.post(SEARCH, async ({ request }) => {
        const body = (await request.json()) as SearchBody;
        return HttpResponse.json({
          results: [],
          incomplete_types: body.types.includes("team") ? ["team"] : [],
          more_projects: false,
        });
      }),
    );
    renderShell(scopedPath("/teams", "proj_1"));
    await userEvent.click(await screen.findByRole("button", { name: "Search" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Go to" }));
    await userEvent.type(
      dialog.getByPlaceholderText("Go to a page, user, team or project, or run an action"),
      "qq",
    );

    expect(await dialog.findByText("Nothing in console-dev matches “qq”")).toBeInTheDocument();
    expect(dialog.getByText("More may match. Type more to narrow it down.")).toBeInTheDocument();
  });

  it("inside a project searches that project alone", async () => {
    const asked: (string | null)[] = [];
    server.use(
      http.post(SEARCH, ({ request }) => {
        asked.push(new URL(request.url).searchParams.get("project_id"));
        return HttpResponse.json({ results: [], incomplete_types: [], more_projects: false });
      }),
    );
    renderShell(scopedPath("/teams", "proj_1"));
    await userEvent.click(await screen.findByRole("button", { name: "Search" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Go to" }));
    await userEvent.type(
      dialog.getByPlaceholderText("Go to a page, user, team or project, or run an action"),
      "supp",
    );

    await waitFor(() => expect(asked.length).toBeGreaterThan(0));
    expect(asked.every((projectId) => projectId === "proj_1")).toBe(true);
  });

  it("at All projects finds a team in a project and opens it there", async () => {
    server.use(
      http.get(MY_PROJECTS, () =>
        HttpResponse.json({
          projects: [
            { id: "proj_1", name: "River" },
            { id: "proj_2", name: "Delta" },
          ],
        }),
      ),
      http.post(SEARCH, async ({ request }) => {
        const body = (await request.json()) as SearchBody;
        return HttpResponse.json({
          results: body.types.includes("team")
            ? [
                { type: "team", id: "team_d", project_id: "proj_2", title: "Support" },
                // A project the palette has not listed is named by its id.
                { type: "team", id: "team_x", project_id: "proj_9", title: "Support Desk" },
              ]
            : [],
          incomplete_types: [],
          more_projects: false,
        });
      }),
      http.get("*/api/v1/teams/team_d", () =>
        HttpResponse.json({
          id: "team_d",
          name: "Support",
          status: "active",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        }),
      ),
    );
    const router = renderShell();
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/projects"));
    await userEvent.click(await screen.findByRole("button", { name: "Search" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Go to" }));
    await userEvent.type(
      dialog.getByPlaceholderText("Go to a page, user, team or project, or run an action"),
      "supp",
    );

    // Beneath each: the project it is in.
    await waitFor(() =>
      expect(rows(dialog.getByRole("listbox"))).toEqual([
        "Support · Delta",
        "Support Desk · proj_9",
      ]),
    );
    await userEvent.click(dialog.getByRole("option", { name: /Delta/ }));
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/teams/team_d"));
    expect(router.state.resolvedLocation?.search).toMatchObject({ project: "proj_2" });
  });
});
