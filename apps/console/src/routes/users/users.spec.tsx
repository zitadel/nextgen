import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.stubEnv("VITE_CONSOLE_API_BASE", "http://localhost/api");

const USERS_URL = "http://localhost/api/users";
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => {
  server.close();
  vi.unstubAllEnvs();
});

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
    server.use(
      http.get(USERS_URL, () =>
        HttpResponse.json([{ id: "user_1", username: "Maya Patel", email: "maya.patel@acme.com" }]),
      ),
    );
    await renderUsers();
    expect(await screen.findByRole("heading", { name: "Users" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Maya Patel" })).toBeInTheDocument();
    expect(screen.getByText("maya.patel@acme.com")).toBeInTheDocument();
  });

  it("shows a status pill for a blocked user", async () => {
    server.use(
      http.get(USERS_URL, () =>
        HttpResponse.json([
          { id: "user_1", username: "Kenji Okafor", email: "kenji@acme.com", status: "Blocked" },
        ]),
      ),
    );
    await renderUsers();
    expect(await screen.findByText("Blocked")).toBeInTheDocument();
  });

  it("filters the table by the user-type tabs", async () => {
    server.use(
      http.get(USERS_URL, () =>
        HttpResponse.json([
          { id: "user_1", username: "Maya Patel", email: "maya@acme.com", type: "Human" },
          { id: "user_2", username: "Sasha Kim", email: "sasha@acme.com", type: "Agent" },
        ]),
      ),
    );
    await renderUsers();
    expect(await screen.findByText("Maya Patel")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Agent" }));

    // Sasha Kim (Agent) remains; Maya Patel (Human) is filtered out.
    expect(await screen.findByText("Sasha Kim")).toBeInTheDocument();
    expect(screen.queryByText("Maya Patel")).not.toBeInTheDocument();
  });
});
