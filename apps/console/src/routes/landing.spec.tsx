import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { _setRuntimeForTesting } from "../runtime/runtime";
import { server } from "@/test/msw";
import { createAppRouter } from "../router";

// The `_authed` layout guards every screen behind `GET /sessions/me`
// (Console ADR 0003); mock the auth module so routes render as signed in.
vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  const { makeTestSession } = await import("@/test/session.fixture");
  return { ...actual, fetchSession: vi.fn(async () => makeTestSession()) };
});

async function renderAt(path: string) {
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

/** What a project's Overview reads (D35), recording which project it read. */
function overviewReads(projectReads: string[]) {
  return [
    http.get("http://localhost/api/v1/projects/:projectId", ({ params }) => {
      const id = String(params.projectId);
      projectReads.push(id);
      return HttpResponse.json({ ...project(id, "Acme"), origins: [], owning_team_id: null });
    }),
    http.get("http://localhost/api/v1/deployments", () => HttpResponse.json({ deployments: [] })),
    http.get("http://localhost/api/v1/events", () => HttpResponse.json({ data: [] })),
  ];
}

/**
 * `/` is a project's Overview, and Projects itself when no project is chosen;
 * `/settings` has no screen of its own and lands on the first one behind it.
 *
 * Worth its own spec because these are the two paths nobody navigates to
 * deliberately: `/` is where sign-in, the logo and the claim flow's "Open the
 * console" all arrive, and `/settings` is where the sidebar's Settings row goes.
 */
describe("landing routes", () => {
  // `/` is the project's Overview (D35), a project-scoped screen, so with no
  // `?project=` the `_authed` guard picks one (`resolveDefaultProjectScope`).
  it("lands on the Overview of the only project the person can act on", async () => {
    const projectReads: string[] = [];
    server.use(
      http.get("http://localhost/api/v1/users/me/projects", () =>
        HttpResponse.json({ projects: [project("proj_1", "Acme")] }),
      ),
      ...overviewReads(projectReads),
    );
    const router = await renderAt("/");

    await waitFor(() =>
      expect(router.state.resolvedLocation?.search).toMatchObject({ project: "proj_1" }),
    );
    expect(router.state.resolvedLocation?.pathname).toBe("/");
    expect(await screen.findByRole("heading", { name: "Acme", level: 1 })).toBeInTheDocument();
    expect(projectReads).toEqual(["proj_1"]);
  });

  it("lands on Projects when there are several to choose from", async () => {
    server.use(
      http.get("http://localhost/api/v1/users/me/projects", () =>
        HttpResponse.json({ projects: [project("proj_1", "Acme"), project("proj_2", "Globex")] }),
      ),
    );
    const router = await renderAt("/");

    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/projects"));
    expect(router.state.resolvedLocation?.search).not.toHaveProperty("project");
    // Projects itself rather than the way to Overview: arriving at the console
    // asked for no screen (D22).
    expect(router.state.resolvedLocation?.search).not.toHaveProperty("next");
    expect(await screen.findByRole("heading", { name: "Projects" })).toBeInTheDocument();
  });

  it("keeps a scoped deep link's target while the person picks a project", async () => {
    // A link shared before the selection was part of the URL: several projects
    // to choose from, so the guard asks, and choosing one ends on the link.
    server.use(
      http.get("http://localhost/api/v1/users/me/projects", () =>
        HttpResponse.json({ projects: [project("proj_1", "Acme"), project("proj_2", "Globex")] }),
      ),
      // The link's own screen, once it is reached.
      http.get("http://localhost/api/v1/users/usr_1", () =>
        HttpResponse.json({ id: "usr_1", schema: "sch_1", attributes: {}, metadata: {} }),
      ),
      http.get("http://localhost/api/v1/users/usr_1/passkeys", () =>
        HttpResponse.json({ passkeys: [] }),
      ),
      http.get("http://localhost/api/v1/users/usr_1/identity_links", () =>
        HttpResponse.json({ identity_links: [] }),
      ),
      http.get("http://localhost/api/v1/users/usr_1/password", () => HttpResponse.json({})),
      http.get("http://localhost/api/v1/schemas/sch_1", () =>
        HttpResponse.json({ id: "sch_1", schema: { properties: {} }, metadata: {} }),
      ),
    );
    const router = await renderAt("/users/usr_1");

    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/projects"));
    expect(router.state.resolvedLocation?.search).toMatchObject({ next: "/users/usr_1" });

    await userEvent.click(await screen.findByRole("link", { name: "Globex" }));
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/users/usr_1"));
    expect(router.state.resolvedLocation?.search).toEqual({ project: "proj_2" });
  });

  it("selects the only project on an unscoped screen too", async () => {
    // `/projects` opened directly agrees with `/`: one project, so it is selected.
    server.use(
      http.get("http://localhost/api/v1/users/me/projects", () =>
        HttpResponse.json({ projects: [project("proj_1", "Acme")] }),
      ),
    );
    const router = await renderAt("/projects");

    await waitFor(() =>
      expect(router.state.resolvedLocation?.search).toMatchObject({ project: "proj_1" }),
    );
    expect(router.state.resolvedLocation?.pathname).toBe("/projects");
  });

  it("asks for the person's projects once for the guard and the switcher", async () => {
    // The Projects screen pages the list itself (`limit`); the guard and the
    // switcher share one unpaged read. System is a screen with both.
    let unpaged = 0;
    server.use(
      http.get("http://localhost/api/v1/users/me/projects", ({ request }) => {
        if (!new URL(request.url).searchParams.has("limit")) unpaged += 1;
        return HttpResponse.json({
          projects: [project("proj_1", "Acme"), project("proj_2", "Globex")],
        });
      }),
    );
    server.use(http.get("*/api/v1/readyz", () => HttpResponse.text("ok")));
    await renderAt("/system");

    const pill = await screen.findByRole("button", { name: "Switch project" });
    await waitFor(() => expect(pill).toHaveTextContent("Select a project"));
    expect(unpaged).toBe(1);
  });

  it("selects the person's project, not the one the console signs into", async () => {
    // `dev-real --claim` and a platform deployment sign in to the platform
    // project, which the developer who just claimed a project cannot manage:
    // their project is the default.
    _setRuntimeForTesting({ mode: "standalone", console_project_id: "proj_platform" });
    const projectReads: string[] = [];
    server.use(
      http.get("http://localhost/api/v1/users/me/projects", () =>
        HttpResponse.json({ projects: [project("proj_1", "Acme")] }),
      ),
      ...overviewReads(projectReads),
    );
    const router = await renderAt("/");

    await waitFor(() =>
      expect(router.state.resolvedLocation?.search).toMatchObject({ project: "proj_1" }),
    );
    expect(router.state.resolvedLocation?.pathname).toBe("/");
    await waitFor(() => expect(projectReads).toEqual(["proj_1"]));
  });

  it("does not take one listed project as the only one while more pages follow", async () => {
    server.use(
      http.get("http://localhost/api/v1/users/me/projects", () =>
        HttpResponse.json({ projects: [project("proj_1", "Acme")], next_page_token: "page_2" }),
      ),
    );
    const router = await renderAt("/");

    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/projects"));
    expect(router.state.resolvedLocation?.search).not.toHaveProperty("project");
  });

  it("selects nothing for a person with no projects", async () => {
    // Not the sign-in project either: on a platform deployment that is the
    // platform project, and every screen in it would refuse this person.
    _setRuntimeForTesting({ mode: "standalone", console_project_id: "proj_platform" });
    server.use(
      http.get("http://localhost/api/v1/users/me/projects", () =>
        HttpResponse.json({ projects: [] }),
      ),
    );
    const router = await renderAt("/");

    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/projects"));
    expect(router.state.resolvedLocation?.search).not.toHaveProperty("project");
    expect(
      await screen.findByRole("region", { name: "Create your first project" }),
    ).toBeInTheDocument();
  });

  it("selects nothing when the person's projects cannot be read", async () => {
    server.use(
      http.get("http://localhost/api/v1/users/me/projects", ({ request }) =>
        new URL(request.url).searchParams.has("limit")
          ? HttpResponse.json({ projects: [] })
          : HttpResponse.json({ code: "internal" }, { status: 500 }),
      ),
    );
    const router = await renderAt("/");

    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/projects"));
    expect(router.state.resolvedLocation?.search).not.toHaveProperty("project");
  });

  it("forwards Settings to its list's first page, and says so when it holds none", async () => {
    // No add-on here, so the root's Settings hold nothing (D41); the person's
    // profile is the account menu's, at /account.
    const router = await renderAt("/settings");

    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/settings"));
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText("Nothing here is yours to set.")).toBeInTheDocument();
    // No Admins row survives from when that screen lived here.
    expect(screen.queryByRole("link", { name: /Admins/ })).not.toBeInTheDocument();
  });
});
