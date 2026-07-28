import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
 * The sidebar reproduces the Figma `Sidebar 08.` mock: a flat list of 7 items.
 * Built screens come from `staticData.nav` on the route tree (Console ADR 0001)
 * and render as links; the remaining design-only entries (screens not built yet)
 * come from `DESIGN_ONLY_NAV` and render as non-navigable items so the sidebar
 * matches the design pixel-for-pixel. Also covers the theme toggle writing
 * `data-theme` + persisting the preference.
 */
const NAV_ORDER = [
  "Projects",
  "Users",
  "App groups",
  "Applications",
  "Analytics",
  "Sessions",
  "Activity Log",
];
const BUILT_ITEMS = ["Projects", "Users", "Sessions"];

function renderShell() {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: ["/"] }) });
  render(<RouterProvider router={router} />);
}

describe("app shell navigation", () => {
  it("renders the 7 design items in order, linking only the built screens", async () => {
    renderShell();
    await screen.findByRole("link", { name: /^Projects/ });
    const nav = within(screen.getByRole("navigation", { name: "Primary" }));

    const items = nav.getAllByRole("listitem");
    expect(items.map((li) => li.textContent?.trim())).toEqual(NAV_ORDER);

    for (const label of BUILT_ITEMS) {
      expect(nav.getByRole("link", { name: new RegExp(`^${label}`) })).toBeInTheDocument();
    }
    // Built rows are links; design-only rows are focusable buttons marked
    // aria-disabled (the logo is a separate Home link outside the list).
    const linkedRows = items.filter((li) => within(li).queryByRole("link"));
    expect(linkedRows).toHaveLength(BUILT_ITEMS.length);
    const designOnly = NAV_ORDER.filter((label) => !BUILT_ITEMS.includes(label));
    for (const label of designOnly) {
      expect(nav.getByRole("button", { name: label })).toHaveAttribute("aria-disabled", "true");
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
    await screen.findByRole("link", { name: /^Projects/ });

    await userEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");

    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });
});
