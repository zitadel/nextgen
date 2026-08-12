import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
const NAV_ORDER = ["Teams", "Users"];
const NESTED_NAV = { parent: "Users", label: "User schemas" };
// Absent for three different reasons, all of them deliberate:
//   - the first four have no endpoint at all
//   - Sessions was built, but `POST /sessions/query` answers 501 (#699)
//   - Projects works and stays reachable at its URL; it has simply never been
//     designed, so it is not advertised as a finished screen
const NEVER_SHOWN = [
  "App groups",
  "Applications",
  "Analytics",
  "Activity Log",
  "Sessions",
  "Projects",
];

// A path pattern rather than an absolute URL: this spec imports the router
// statically, so `api/zitadel.ts` evaluates its base URL before `vi.stubEnv`
// could run — the request goes to the relative default.
const server = setupServer(
  http.post("*/api/projects/query", () =>
    HttpResponse.json({ projects: [{ id: "proj_1", name: "console-dev" }] }),
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterAll(() => server.close());

function renderShell(path = "/") {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });
  render(<RouterProvider router={router} />);
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
    ).toHaveAttribute("href", "/schemas");
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
    expect(screen.getByRole("menuitem", { name: "Settings" })).toHaveAttribute(
      "href",
      "/settings",
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
    // The switcher used to hardcode "River". `queryProjects` is scope-pinned to
    // the caller's own project (ADR 0004), so this normally resolves to one entry.
    renderShell();
    const switcher = await screen.findByRole("button", { name: "Switch project" });
    await vi.waitFor(() => expect(switcher).toHaveTextContent("console-dev"));
    expect(switcher).not.toHaveTextContent("River");
  });
});
