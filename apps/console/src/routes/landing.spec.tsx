import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { _setRuntimeForTesting } from "../runtime/runtime";

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
 * Neither `/` nor `/settings` has a screen of its own; each lands on the first
 * one behind it.
 *
 * Worth its own spec because these are the two paths nobody navigates to
 * deliberately: `/` is where sign-in, the logo and the claim flow's "Open the
 * console" all arrive, and `/settings` is where the account dropdown goes.
 */
describe("landing routes", () => {
  // `/` lands on Teams, a project-scoped screen, so with no `?project=` the
  // `_authed` guard picks one (`resolveDefaultProjectScope`).
  it("lands on Teams in the only project the person can act on", async () => {
    const teamQueries: string[] = [];
    server.use(
      http.get("http://localhost/api/users/me/projects", () =>
        HttpResponse.json({ projects: [project("proj_1", "Acme")] }),
      ),
      http.post("http://localhost/api/teams/query", ({ request }) => {
        teamQueries.push(new URL(request.url).searchParams.get("project_id") ?? "");
        return HttpResponse.json({ teams: [] });
      }),
    );
    const router = await renderAt("/");

    await waitFor(() => expect(router.state.location.pathname).toBe("/teams"));
    expect(router.state.location.search).toMatchObject({ project: "proj_1" });
    expect(await screen.findByRole("heading", { name: "Teams" })).toBeInTheDocument();
    expect(teamQueries).toEqual(["proj_1"]);
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

  it("keeps a scoped deep link's target while the person picks a project", async () => {
    // A link shared before the selection was part of the URL: several projects
    // to choose from, so the guard asks, and choosing one ends on the link.
    server.use(
      http.get("http://localhost/api/users/me/projects", () =>
        HttpResponse.json({ projects: [project("proj_1", "Acme"), project("proj_2", "Globex")] }),
      ),
      // The link's own screen, once it is reached.
      http.get("http://localhost/api/users/usr_1", () =>
        HttpResponse.json({ id: "usr_1", schema: "sch_1", attributes: {}, metadata: {} }),
      ),
      http.get("http://localhost/api/users/usr_1/passkeys", () =>
        HttpResponse.json({ passkeys: [] }),
      ),
      http.get("http://localhost/api/schemas/sch_1", () =>
        HttpResponse.json({ id: "sch_1", schema: { properties: {} }, metadata: {} }),
      ),
    );
    const router = await renderAt("/users/usr_1");

    await waitFor(() => expect(router.state.location.pathname).toBe("/projects"));
    expect(router.state.location.search).toMatchObject({ next: "/users/usr_1" });

    await userEvent.click(await screen.findByRole("link", { name: "Globex" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/users/usr_1"));
    expect(router.state.location.search).toEqual({ project: "proj_2" });
  });

  it("selects the only project on an unscoped screen too", async () => {
    // `/projects` opened directly agrees with `/`: one project, so it is selected.
    server.use(
      http.get("http://localhost/api/users/me/projects", () =>
        HttpResponse.json({ projects: [project("proj_1", "Acme")] }),
      ),
    );
    const router = await renderAt("/projects");

    await waitFor(() => expect(router.state.location.search).toMatchObject({ project: "proj_1" }));
    expect(router.state.location.pathname).toBe("/projects");
  });

  it("asks for the person's projects once for the guard and the switcher", async () => {
    // The Projects screen pages the list itself (`limit`); the guard and the
    // switcher share one unpaged read.
    let unpaged = 0;
    server.use(
      http.get("http://localhost/api/users/me/projects", ({ request }) => {
        if (!new URL(request.url).searchParams.has("limit")) unpaged += 1;
        return HttpResponse.json({
          projects: [project("proj_1", "Acme"), project("proj_2", "Globex")],
        });
      }),
    );
    const router = await renderAt("/");

    await waitFor(() => expect(router.state.location.pathname).toBe("/projects"));
    const pill = await screen.findByRole("button", { name: "Switch project" });
    await waitFor(() => expect(pill).toHaveTextContent("Select a project"));
    expect(unpaged).toBe(1);
  });

  it("selects the person's project, not the one the console signs into", async () => {
    // `dev-real --claim` and a platform deployment sign in to the platform
    // project, which the developer who just claimed a project cannot manage:
    // their project is the default.
    _setRuntimeForTesting({ mode: "standalone", console_project_id: "proj_platform" });
    server.use(
      http.get("http://localhost/api/users/me/projects", () =>
        HttpResponse.json({ projects: [project("proj_1", "Acme")] }),
      ),
      http.post("http://localhost/api/teams/query", () => HttpResponse.json({ teams: [] })),
    );
    const router = await renderAt("/");

    await waitFor(() => expect(router.state.location.pathname).toBe("/teams"));
    expect(router.state.location.search).toMatchObject({ project: "proj_1" });
  });

  it("does not take one listed project as the only one while more pages follow", async () => {
    server.use(
      http.get("http://localhost/api/users/me/projects", () =>
        HttpResponse.json({ projects: [project("proj_1", "Acme")], next_page_token: "page_2" }),
      ),
    );
    const router = await renderAt("/");

    await waitFor(() => expect(router.state.location.pathname).toBe("/projects"));
    expect(router.state.location.search).not.toHaveProperty("project");
  });

  it("selects nothing for a person with no projects", async () => {
    // Not the sign-in project either: on a platform deployment that is the
    // platform project, and every screen in it would refuse this person.
    _setRuntimeForTesting({ mode: "standalone", console_project_id: "proj_platform" });
    server.use(
      http.get("http://localhost/api/users/me/projects", () => HttpResponse.json({ projects: [] })),
    );
    const router = await renderAt("/");

    await waitFor(() => expect(router.state.location.pathname).toBe("/projects"));
    expect(router.state.location.search).not.toHaveProperty("project");
    expect(await screen.findByText("No projects yet.")).toBeInTheDocument();
  });

  it("selects nothing when the person's projects cannot be read", async () => {
    server.use(
      http.get("http://localhost/api/users/me/projects", ({ request }) =>
        new URL(request.url).searchParams.has("limit")
          ? HttpResponse.json({ projects: [] })
          : HttpResponse.json({ code: "internal" }, { status: 500 }),
      ),
    );
    const router = await renderAt("/");

    await waitFor(() => expect(router.state.location.pathname).toBe("/projects"));
    expect(router.state.location.search).not.toHaveProperty("project");
  });

  it("lands on Profile from settings", async () => {
    // Settings has no landing page of its own; the account dropdown's target
    // forwards to the first settings screen.
    server.use(
      http.get("http://localhost/api/users/me", () =>
        HttpResponse.json({ id: "user_1", attributes: { email: "maya@example.com" } }),
      ),
    );
    const router = await renderAt("/settings");

    await waitFor(() => expect(router.state.location.pathname).toBe("/settings/profile"));
    expect(await screen.findByRole("heading", { name: "Profile" })).toBeInTheDocument();
    // No screen claims WORKSPACE, so the heading is absent and no Admins row
    // survives from when that screen lived here.
    expect(screen.queryByRole("navigation", { name: "WORKSPACE" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Admins/ })).not.toBeInTheDocument();
  });
});
