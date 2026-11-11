import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { _setRuntimeForTesting } from "@/runtime/runtime";
import { server } from "@/test/msw";
import { TEST_PROJECT_ID, scopedPath } from "@/test/project-scope.fixture";
import { createAppRouter } from "../../../../router";

// The `_authed` layout guards every screen behind `GET /sessions/me`
// (Console ADR 0003); mock the auth module so routes render as signed in.
vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  const { makeTestSession } = await import("@/test/session.fixture");
  return { ...actual, fetchSession: vi.fn(async () => makeTestSession()) };
});

const PLATFORM = "proj_platform";
// Absolute base so requests parse under jsdom/undici and MSW can intercept.
const PLATFORM_URL = `http://localhost/api/v1/projects/${PLATFORM}`;
const USERS_URL = "http://localhost/api/v1/users";
const USERS_QUERY_URL = `${USERS_URL}/query`;
const SCHEMA_URL = "http://localhost/api/v1/schemas/sch_people";

const USER = {
  id: "user_1",
  schema: "sch_people",
  identifier: "maya@acme.com",
  identifier_property: "email",
  attributes: { email: "maya@acme.com" },
  metadata: { status: "active", created_at: "2026-07-12T09:00:00Z" },
};

// The console signs in to the project bootstrap provisioned, which the server
// marks as the platform project: the root draws it (D41).
beforeEach(() => {
  _setRuntimeForTesting({
    mode: "standalone",
    console_project_id: PLATFORM,
    publishable_key: "pk",
    platform_project_id: PLATFORM,
  });
});

async function renderAt(path: string) {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });
  render(<RouterProvider router={router} />);
  return router;
}

describe("root people", () => {
  it("lists the platform project's users by the URL's filter, and a row opens the root's detail", async () => {
    const queries: { project: string | null; body: Record<string, unknown> }[] = [];
    const schemaReads: (string | null)[] = [];
    server.use(
      // Someone who may act on the platform project: the read is the access.
      http.get(PLATFORM_URL, () => HttpResponse.json({ id: PLATFORM, name: "Platform" })),
      http.post(USERS_QUERY_URL, async ({ request }) => {
        queries.push({
          project: new URL(request.url).searchParams.get("project_id"),
          body: (await request.json()) as Record<string, unknown>,
        });
        return HttpResponse.json({
          users: [{ ...USER, teams: [{ id: "team_1", name: "Operators" }] }],
        });
      }),
      http.get(SCHEMA_URL, ({ request }) => {
        schemaReads.push(new URL(request.url).searchParams.get("project_id"));
        return HttpResponse.json({ id: "sch_people", schema: { title: "Staff" } });
      }),
      http.get(`${USERS_URL}/user_1`, () => HttpResponse.json(USER)),
      http.get(`${USERS_URL}/user_1/passkeys`, () => HttpResponse.json({ passkeys: [] })),
      http.get(`${USERS_URL}/user_1/identity_links`, () =>
        HttpResponse.json({ identity_links: [] }),
      ),
      http.get(`${USERS_URL}/user_1/password`, () => HttpResponse.json({})),
    );
    // Opened from a project, which stays selected (D36).
    const router = await renderAt(`${scopedPath("/platform/people")}&status=active`);

    const table = within(await screen.findByRole("table"));
    // Titled for the root, not the project's Users (D41).
    expect(screen.getByRole("heading", { name: "People", level: 1 })).toBeInTheDocument();
    const row = table.getByRole("link", { name: "maya@acme.com" });
    // The platform project's users, never the selection's, narrowed by the URL.
    expect(queries.map((query) => query.project)).toEqual([PLATFORM]);
    expect(queries[0]?.body.filter).toEqual([
      { field: "status", operation: "equals", value: "active" },
    ]);
    expect(row.getAttribute("href")).toMatch(/^\/platform\/people\/user_1(\?|$)/);
    expect(row.getAttribute("href")).not.toContain(PLATFORM);
    // The root shows no schemas or teams, so their cells name them as text.
    expect(table.getByText("sch_people")).toBeInTheDocument();
    expect(table.queryByRole("link", { name: "sch_people" })).not.toBeInTheDocument();
    expect(table.getByText("Operators")).toBeInTheDocument();
    expect(table.queryByRole("link", { name: "Operators" })).not.toBeInTheDocument();

    await userEvent.click(row);
    await waitFor(() =>
      expect(router.state.resolvedLocation?.pathname).toBe("/platform/people/user_1"),
    );
    expect(router.state.resolvedLocation?.search).toEqual({ project: TEST_PROJECT_ID });
    expect(await screen.findByRole("heading", { name: "maya@acme.com" })).toBeInTheDocument();
    // The detail reads the schema in the platform project too, and names it
    // without linking it.
    expect(schemaReads).toEqual([PLATFORM, PLATFORM]);
    expect(screen.getByText("Staff")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Staff" })).not.toBeInTheDocument();
  });

  it("returns to People once a person is deleted", async () => {
    let deleted = false;
    server.use(
      http.get(PLATFORM_URL, () => HttpResponse.json({ id: PLATFORM, name: "Platform" })),
      http.get(`${USERS_URL}/user_1`, () => HttpResponse.json(USER)),
      http.get(SCHEMA_URL, () =>
        HttpResponse.json({ id: "sch_people", schema: { title: "Staff" } }),
      ),
      http.get(`${USERS_URL}/user_1/passkeys`, () => HttpResponse.json({ passkeys: [] })),
      http.get(`${USERS_URL}/user_1/identity_links`, () =>
        HttpResponse.json({ identity_links: [] }),
      ),
      http.get(`${USERS_URL}/user_1/password`, () => HttpResponse.json({})),
      http.delete(`${USERS_URL}/user_1`, () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
      http.post(USERS_QUERY_URL, () => HttpResponse.json({ users: [] })),
    );
    const router = await renderAt("/platform/people/user_1");

    await userEvent.click(await screen.findByRole("button", { name: "Delete user" }));
    await userEvent.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
    await userEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete user" }),
    );

    await waitFor(() => expect(deleted).toBe(true));
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/platform/people"));
  });

  it.each(["/platform/people", "/platform/people/user_1"])(
    "sends someone who may not act on the platform project from %s to Projects",
    async (path) => {
      server.use(
        http.get(PLATFORM_URL, () =>
          HttpResponse.json({ code: "proj.not_found", message: "not found" }, { status: 404 }),
        ),
      );
      const router = await renderAt(path);

      await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/projects"));
      expect(await screen.findByRole("heading", { name: "Projects" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "People" })).not.toBeInTheDocument();
    },
  );
});
