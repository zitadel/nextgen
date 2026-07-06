import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Point the SDK at an absolute base so requests parse under jsdom/undici and
// MSW can intercept them. Must run before the router/zitadel module is
// imported, hence the dynamic import in `renderUsers`.
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

describe("users list states", () => {
  it("shows the empty state when the API returns no users", async () => {
    server.use(http.get(USERS_URL, () => HttpResponse.json([])));
    await renderUsers();
    expect(await screen.findByText("No users yet.")).toBeInTheDocument();
  });

  it("renders a row per user", async () => {
    server.use(
      http.get(USERS_URL, () =>
        HttpResponse.json([
          { id: "user_1", username: "alice", email: "alice@example.com", created_at: "2026-01-01" },
        ]),
      ),
    );
    await renderUsers();
    expect(await screen.findByRole("link", { name: "alice" })).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
  });

  it("renders the error boundary when the request fails", async () => {
    server.use(
      http.get(USERS_URL, () =>
        HttpResponse.json({ code: "internal", message: "boom" }, { status: 500 }),
      ),
    );
    await renderUsers();
    expect(await screen.findByText("Request failed (500)")).toBeInTheDocument();
  });
});
