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
 * `/` has no screen of its own and lands on the first one behind it; `/settings`
 * is a view with nothing built in it yet and says so.
 *
 * Worth its own spec because these are the two paths nobody navigates to
 * deliberately: `/` is where sign-in, the logo and the claim flow's "Open the
 * console" all arrive, and `/settings` is where the account dropdown goes.
 */
describe("landing routes", () => {
  it("lands on Teams from the console root", async () => {
    server.use(
      http.post("http://localhost/api/teams/query", () => HttpResponse.json({ teams: [] })),
    );
    const router = await renderAt("/");

    await waitFor(() => expect(router.state.location.pathname).toBe("/teams"));
    expect(await screen.findByRole("heading", { name: "Teams" })).toBeInTheDocument();
  });

  it("shows the empty settings view from settings", async () => {
    // Settings has no built screen yet: Admins moved to the project page
    // (#1238) and Profile is not built, so the account dropdown's target is the
    // view's own empty state rather than a redirect somewhere unrelated.
    const router = await renderAt("/settings");

    await waitFor(() => expect(router.state.location.pathname).toBe("/settings"));
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText("No settings yet.")).toBeInTheDocument();
    // Asserted here, where the Settings nav is actually mounted: no route
    // claims a Settings heading any more, so neither a WORKSPACE group over
    // nothing nor an Admins row survives.
    expect(screen.queryByRole("navigation", { name: "WORKSPACE" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Admins/ })).not.toBeInTheDocument();
  });
});
