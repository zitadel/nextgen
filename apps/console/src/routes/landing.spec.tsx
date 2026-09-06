import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
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

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => {
  server.close();
  vi.unstubAllEnvs();
});

async function renderAt(path: string) {
  const { createAppRouter } = await import("../router");
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });
  render(<RouterProvider router={router} />);
  return router;
}

/**
 * Neither `/` nor `/settings` has a screen of its own, so both land on the first
 * screen behind them rather than rendering a page that explains the absence.
 *
 * Worth its own spec because these are the two paths nobody navigates to
 * deliberately: `/` is where sign-in, the logo and the claim flow's "Open the
 * console" all arrive, and `/settings` is where the account dropdown goes.
 */
describe("landing routes", () => {
  it("lands on Users from the console root", async () => {
    server.use(
      http.post("http://localhost/api/users/query", () => HttpResponse.json({ users: [] })),
      http.post("http://localhost/api/projects/query", () => HttpResponse.json({ projects: [] })),
    );
    const router = await renderAt("/");

    await waitFor(() => expect(router.state.location.pathname).toBe("/users"));
    expect(await screen.findByRole("heading", { name: "Users" })).toBeInTheDocument();
  });

  it("lands on Admins from settings", async () => {
    server.use(
      http.post("http://localhost/api/grants/query", () => HttpResponse.json({ grants: [] })),
    );
    const router = await renderAt("/settings");

    await waitFor(() => expect(router.state.location.pathname).toBe("/settings/admins"));
    expect(await screen.findByRole("heading", { name: "Admins" })).toBeInTheDocument();
  });
});
