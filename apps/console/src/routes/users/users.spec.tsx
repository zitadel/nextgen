import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

async function renderUsers() {
  const [{ RouterProvider, createMemoryHistory }, { createAppRouter }] = await Promise.all([
    import("@tanstack/react-router"),
    import("../../router"),
  ]);
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: ["/users"] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe("users screen", () => {
  it("renders the page heading and a user row", async () => {
    await renderUsers();
    expect(await screen.findByRole("heading", { name: "Users" })).toBeInTheDocument();
    expect(await screen.findByText("Maya Patel")).toBeInTheDocument();
    expect(screen.getByText("maya.patel@acme.com")).toBeInTheDocument();
  });

  it("shows a status pill for a blocked user", async () => {
    await renderUsers();
    expect(await screen.findByText("Blocked")).toBeInTheDocument();
  });

  it("filters the table by the user-type tabs", async () => {
    await renderUsers();
    expect(await screen.findByText("Maya Patel")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Agent" }));

    // Sasha Kim (Agent) remains; Maya Patel (Human) is filtered out.
    expect(await screen.findByText("Sasha Kim")).toBeInTheDocument();
    expect(screen.queryByText("Maya Patel")).not.toBeInTheDocument();
  });
});
