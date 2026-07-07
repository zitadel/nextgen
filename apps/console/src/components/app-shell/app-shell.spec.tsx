import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createAppRouter } from "../../router";

/**
 * The sidebar is built by reading `staticData.nav` off the route tree
 * (Console ADR 0001), so this asserts the group headings and links are
 * derived from route metadata — not a hand-maintained list.
 */
describe("app shell navigation", () => {
  it("renders nav groups and links from route metadata", async () => {
    const router = createAppRouter({ history: createMemoryHistory({ initialEntries: ["/"] }) });
    render(<RouterProvider router={router} />);

    // Ungrouped, top-of-sidebar item.
    expect(await screen.findByRole("link", { name: "Dashboard" })).toBeInTheDocument();

    // Identity group.
    expect(screen.getByText("Identity")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Users" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Teams" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sessions" })).toBeInTheDocument();

    // Configuration group.
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Flow Definitions" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Schemas" })).toBeInTheDocument();
  });
});
