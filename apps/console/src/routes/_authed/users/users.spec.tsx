import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// The `_authed` layout guards every screen behind `GET /sessions/me`
// (Console ADR 0003); mock the auth module so routes render as signed in.
vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  const { makeTestSession } = await import("@/auth/session.fixture");
  return { ...actual, fetchSession: vi.fn(async () => makeTestSession()) };
});

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
    import("../../../router"),
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

  it("uses schema-defined email as the display name and shows the user id", async () => {
    server.use(
      http.get(USERS_URL, () =>
        HttpResponse.json([{ id: "user_1", email: "kenji@acme.com", status: "Blocked" }]),
      ),
    );
    await renderUsers();
    expect(await screen.findByRole("link", { name: "kenji@acme.com" })).toBeInTheDocument();
    expect(screen.getByText("user_1")).toBeInTheDocument();
    expect(screen.queryByText("Blocked")).not.toBeInTheDocument();
  });

  it("renders the not-authorized state on a 401 with a live session (no redirect loop)", async () => {
    // A 401 data call while `GET /sessions/me` still answers with a session
    // means the operator-plane credential is missing (e.g. no dev-proxy
    // secret) — the boundary must render copy, not bounce to /login.
    server.use(
      http.get(USERS_URL, () =>
        HttpResponse.json(
          {
            code: "auth.unauthorized",
            message: "The request lacks valid authentication credentials.",
          },
          { status: 401 },
        ),
      ),
    );
    const router = await renderUsers();

    expect(await screen.findByText("Console API not authorized")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/users");
  });

  it("filters live users by name, email, or id", async () => {
    server.use(
      http.get(USERS_URL, () =>
        HttpResponse.json([
          { id: "user_1", username: "Maya Patel", email: "maya@acme.com" },
          { id: "user_2", username: "Sasha Kim", email: "sasha@acme.com" },
        ]),
      ),
    );
    await renderUsers();
    expect(await screen.findByText("Maya Patel")).toBeInTheDocument();

    await userEvent.type(screen.getByRole("searchbox", { name: "Search users" }), "user_2");

    expect(await screen.findByText("Sasha Kim")).toBeInTheDocument();
    expect(screen.queryByText("Maya Patel")).not.toBeInTheDocument();
  });
});
