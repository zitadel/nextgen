import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { THEME_STORAGE_KEY } from "../../theme";
import { createAppRouter } from "../../router";

/**
 * The sidebar reproduces the Figma admin mock: a single flat list of 11 items.
 * Built screens come from `staticData.nav` on the route tree (Console ADR 0001)
 * and render as links; the remaining design-only entries (screens not built yet)
 * come from `DESIGN_ONLY_NAV` and render as non-navigable items so the sidebar
 * matches the design pixel-for-pixel. Also covers the theme toggle writing
 * `data-theme` + persisting the preference.
 */
const NAV_ORDER = [
  "Get started",
  "Projects",
  "Users",
  "App groups",
  "Applications",
  "Actions",
  "Role assignments",
  "Analytics",
  "Sessions",
  "Activity Log",
  "Manage team",
];
const BUILT_ITEMS = ["Get started", "Projects", "Users", "Sessions"];

function renderShell() {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: ["/"] }) });
  render(<RouterProvider router={router} />);
}

describe("app shell navigation", () => {
  it("renders all 11 design items in order, linking only the built screens", async () => {
    renderShell();
    await screen.findByRole("link", { name: "Get started" });
    const nav = within(screen.getByRole("navigation", { name: "Primary" }));

    const labels = nav
      .getAllByRole("listitem")
      .map((li) => li.textContent?.replace(/[\d,]/g, "").trim());
    expect(labels).toEqual(NAV_ORDER);

    for (const label of BUILT_ITEMS) {
      expect(nav.getByRole("link", { name: new RegExp(`^${label}`) })).toBeInTheDocument();
    }
    expect(nav.getAllByRole("link")).toHaveLength(BUILT_ITEMS.length);
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
    await screen.findByRole("link", { name: "Get started" });

    await userEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");

    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });
});
