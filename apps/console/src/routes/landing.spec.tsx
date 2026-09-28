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

function project(id: string, name: string) {
  return {
    id,
    name,
    status: "active",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

/**
 * `/` has no screen of its own: with no project selected it lands on the
 * project directory, and with one it lands on that project's Teams. `/settings`
 * lands on the Settings view's first row, Profile.
 *
 * Worth its own spec because these are the two paths nobody navigates to
 * deliberately: `/` is where sign-in, the logo and the claim flow's "Open the
 * console" all arrive, and `/settings` is where the account dropdown goes.
 */
describe("landing routes", () => {
  it("lands on Projects without a selection, even with a single project", async () => {
    // The console is entered through its project directory rather than by
    // auto-selecting the only project.
    server.use(
      http.get("http://localhost/api/users/me/projects", () =>
        HttpResponse.json({ projects: [project("proj_1", "Acme")] }),
      ),
    );
    const router = await renderAt("/");

    await waitFor(() => expect(router.state.location.pathname).toBe("/projects"));
    expect(router.state.location.search).not.toHaveProperty("project");
  });

  it("lands on Teams in the selected project", async () => {
    const teamQueries: string[] = [];
    server.use(
      http.get("http://localhost/api/users/me/projects", () =>
        HttpResponse.json({ projects: [project("proj_1", "Acme"), project("proj_2", "Globex")] }),
      ),
      http.post("http://localhost/api/teams/query", ({ request }) => {
        teamQueries.push(new URL(request.url).searchParams.get("project_id") ?? "");
        return HttpResponse.json({ teams: [] });
      }),
    );
    const router = await renderAt("/?project=proj_2");

    await waitFor(() => expect(router.state.location.pathname).toBe("/teams"));
    expect(router.state.location.search).toMatchObject({ project: "proj_2" });
    expect(await screen.findByRole("heading", { name: "Teams" })).toBeInTheDocument();
    expect(teamQueries).toEqual(["proj_2"]);
  });

  it("lands on Projects when there are several to choose from", async () => {
    server.use(
      http.get("http://localhost/api/users/me/projects", () =>
        HttpResponse.json({ projects: [project("proj_1", "Acme"), project("proj_2", "Globex")] }),
      ),
    );
    const router = await renderAt("/");

    await waitFor(() => expect(router.state.location.pathname).toBe("/projects"));
    expect(router.state.location.search).not.toHaveProperty("project");
  });

  it("takes the pinned dev project without asking", async () => {
    vi.stubEnv("VITE_CONSOLE_PROJECT_ID", "proj_pinned");
    // One other project on offer: without the pin it would be the landing.
    server.use(
      http.get("http://localhost/api/users/me/projects", () =>
        HttpResponse.json({ projects: [project("proj_1", "Acme")] }),
      ),
      http.post("http://localhost/api/teams/query", () => HttpResponse.json({ teams: [] })),
    );
    try {
      const router = await renderAt("/");

      await waitFor(() => expect(router.state.location.pathname).toBe("/teams"));
      expect(router.state.location.search).toMatchObject({ project: "proj_pinned" });
    } finally {
      vi.stubEnv("VITE_CONSOLE_PROJECT_ID", "");
    }
  });

  it("lands on Profile from settings", async () => {
    // `/settings` is not a screen of its own; the account dropdown's target is
    // the Settings view's first row. Profile shows the signed-in identifier.
    const router = await renderAt("/settings");

    await waitFor(() => expect(router.state.location.pathname).toBe("/settings/profile"));
    expect(await screen.findByRole("heading", { name: "Profile" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email address")).toHaveValue("test.user@example.com");
    expect(screen.getByLabelText("Email address")).toBeDisabled();
    // Both Settings headings are claimed now: ACCOUNT › Profile and
    // WORKSPACE › Members.
    expect(screen.getByRole("navigation", { name: "ACCOUNT" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "WORKSPACE" })).toBeInTheDocument();
  });
});
