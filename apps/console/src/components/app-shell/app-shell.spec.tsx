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
// Users is the only surface with a design hand-off, so it is the only thing the
// sidebar offers.
const NAV_ORDER = ["Users"];
// Absent for three different reasons, all of them deliberate:
//   - the first four have no endpoint at all
//   - Sessions was built, but `GET /sessions` answers 501 (#699)
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

function renderShell() {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: ["/"] }) });
  render(<RouterProvider router={router} />);
}

describe("app shell navigation", () => {
  it("lists only built screens, every one of them a link", async () => {
    renderShell();
    await screen.findByRole("link", { name: /^Users/ });
    const nav = within(screen.getByRole("navigation", { name: "Primary" }));

    const items = nav.getAllByRole("listitem");
    expect(items.map((li) => li.textContent?.trim())).toEqual(NAV_ORDER);

    // Every row navigates somewhere (the logo is a separate Home link outside
    // the list), so there is no row that looks like a destination but is not.
    const linkedRows = items.filter((li) => within(li).queryByRole("link"));
    expect(linkedRows).toHaveLength(NAV_ORDER.length);
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
