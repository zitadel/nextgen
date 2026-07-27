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
        HttpResponse.json([
          // The shipped `consumer`/`business` presets spell the name parts
          // camelCase; `listUsers` returns the schema's attribute tree verbatim.
          { id: "user_1", givenName: "Maya", familyName: "Patel", email: "maya.patel@acme.com" },
        ]),
      ),
    );
    await renderUsers();
    expect(await screen.findByRole("heading", { name: "Users" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Maya Patel" })).toBeInTheDocument();
    expect(screen.getByText("maya.patel@acme.com")).toBeInTheDocument();
  });

  it("derives the display name the way the platform does", async () => {
    // Mirrors `User.DisplayName` (internal/domain/user.go): explicit `name`
    // wins, else the given/family parts joined, with snake_case accepted for
    // schemas authored that way. A partial name must not render a stray space.
    server.use(
      http.get(USERS_URL, () =>
        HttpResponse.json([
          {
            id: "user_1",
            name: "Ada L.",
            givenName: "Ada",
            familyName: "Lovelace",
            email: "a@x.com",
          },
          { id: "user_2", given_name: "Grace", family_name: "Hopper", email: "g@x.com" },
          { id: "user_3", givenName: "Radia", email: "r@x.com" },
        ]),
      ),
    );
    await renderUsers();
    expect(await screen.findByRole("link", { name: "Ada L." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Grace Hopper" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Radia" })).toBeInTheDocument();
  });

  it("ignores non-identity attributes when deriving the name", async () => {
    // Regression: the screen used to read a `username` property that no shipped
    // schema defines, so every row silently fell back to the email. Reading an
    // unrelated attribute as the name is worse than having none.
    server.use(
      http.get(USERS_URL, () =>
        HttpResponse.json([{ id: "user_1", username: "nope", email: "kenji@acme.com" }]),
      ),
    );
    await renderUsers();
    expect(await screen.findByRole("link", { name: "kenji@acme.com" })).toBeInTheDocument();
    expect(screen.queryByText("nope")).not.toBeInTheDocument();
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
    // secret) — the boundary must render copy, not bounce to /login. The
    // loader error is expected; silence the boundary/router noise.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
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
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("filters live users by name, email, or id", async () => {
    server.use(
      http.get(USERS_URL, () =>
        HttpResponse.json([
          { id: "user_1", givenName: "Maya", familyName: "Patel", email: "maya@acme.com" },
          { id: "user_2", givenName: "Sasha", familyName: "Kim", email: "sasha@acme.com" },
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
