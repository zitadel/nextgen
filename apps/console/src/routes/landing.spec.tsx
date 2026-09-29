import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
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
 * `/` has no screen of its own and lands on the first one behind it; `/settings`
 * is a view with nothing built in it yet and says so.
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
        return HttpResponse.json({ projects: [project("proj_1", "Acme"), project("proj_2", "Globex")] });
      }),
    );
    const router = await renderAt("/");

    await waitFor(() => expect(router.state.location.pathname).toBe("/projects"));
    const pill = await screen.findByRole("button", { name: "Switch project" });
    await waitFor(() => expect(pill).toHaveTextContent("Select a project"));
    expect(unpaged).toBe(1);
  });

  it("takes the pinned dev project among the person's own", async () => {
    vi.stubEnv("VITE_CONSOLE_PROJECT_ID", "proj_2");
    // Several on offer: without the pin the person would be asked to choose.
    server.use(
      http.get("http://localhost/api/users/me/projects", () =>
        HttpResponse.json({ projects: [project("proj_1", "Acme"), project("proj_2", "Globex")] }),
      ),
      http.post("http://localhost/api/teams/query", () => HttpResponse.json({ teams: [] })),
    );
    try {
      const router = await renderAt("/");

      await waitFor(() => expect(router.state.location.pathname).toBe("/teams"));
      expect(router.state.location.search).toMatchObject({ project: "proj_2" });
    } finally {
      vi.stubEnv("VITE_CONSOLE_PROJECT_ID", "");
    }
  });

  it("ignores a pin the person holds no grant on", async () => {
    // `dev-real --claim` pins the platform project, which the developer who
    // just claimed a project cannot manage: their project is the default.
    vi.stubEnv("VITE_CONSOLE_PROJECT_ID", "proj_platform");
    server.use(
      http.get("http://localhost/api/users/me/projects", () =>
        HttpResponse.json({ projects: [project("proj_1", "Acme")] }),
      ),
      http.post("http://localhost/api/teams/query", () => HttpResponse.json({ teams: [] })),
    );
    try {
      const router = await renderAt("/");

      await waitFor(() => expect(router.state.location.pathname).toBe("/teams"));
      expect(router.state.location.search).toMatchObject({ project: "proj_1" });
    } finally {
      vi.stubEnv("VITE_CONSOLE_PROJECT_ID", "");
    }
  });

  it("recognises a pin further down the person's projects", async () => {
    // The list is one page; a pin past it is checked by id, which the server
    // answers only for a project the person holds a grant on.
    vi.stubEnv("VITE_CONSOLE_PROJECT_ID", "proj_42");
    server.use(
      http.get("http://localhost/api/users/me/projects", () =>
        HttpResponse.json({ projects: [project("proj_1", "Acme")], next_page_token: "page_2" }),
      ),
      http.get("http://localhost/api/projects/proj_42", () =>
        HttpResponse.json(project("proj_42", "Far down")),
      ),
      http.post("http://localhost/api/teams/query", () => HttpResponse.json({ teams: [] })),
    );
    try {
      const router = await renderAt("/");

      await waitFor(() => expect(router.state.location.pathname).toBe("/teams"));
      expect(router.state.location.search).toMatchObject({ project: "proj_42" });
    } finally {
      vi.stubEnv("VITE_CONSOLE_PROJECT_ID", "");
    }
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
    vi.stubEnv("VITE_CONSOLE_PROJECT_ID", "proj_platform");
    server.use(
      http.get("http://localhost/api/users/me/projects", () => HttpResponse.json({ projects: [] })),
    );
    try {
      const router = await renderAt("/");

      await waitFor(() => expect(router.state.location.pathname).toBe("/projects"));
      expect(router.state.location.search).not.toHaveProperty("project");
      expect(await screen.findByText("No projects yet.")).toBeInTheDocument();
    } finally {
      vi.stubEnv("VITE_CONSOLE_PROJECT_ID", "");
    }
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
