import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

async function renderAt(path: string) {
  const [{ RouterProvider, createMemoryHistory }, { createAppRouter }] = await Promise.all([
    import("@tanstack/react-router"),
    import("../../router"),
  ]);
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });
  render(<RouterProvider router={router} />);
  return router;
}

describe("schemas list", () => {
  it("shows an honest coming-soon empty state (no fake data)", async () => {
    await renderAt("/schemas");
    expect(await screen.findByText("Coming soon")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Schemas" })).toBeInTheDocument();
  });
});
