import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetRuntimeForTesting, _setRuntimeForTesting } from "@/runtime/runtime";

// The `_authed` layout guards every screen behind `GET /sessions/me`
// (Console ADR 0003); mock the auth module so routes render as signed in.
vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  const { makeTestSession } = await import("@/test/session.fixture");
  return { ...actual, fetchSession: vi.fn(async () => makeTestSession()) };
});

vi.stubEnv("VITE_CONSOLE_API_BASE", "http://localhost/api");

// `GET /users/me/projects`: the projects the signed-in person can act on, read
// with the session cookie (#1237). Not `POST /projects/query`, which the server
// pins to the calling credential's one home project.
const PROJECTS_URL = "http://localhost/api/users/me/projects";
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => {
  server.close();
  vi.unstubAllEnvs();
});

/** The same locale-derived string the screen renders, rather than one locale's output. */
function expectedDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

async function renderProjects(path = "/projects") {
  const [{ RouterProvider, createMemoryHistory }, { createAppRouter }] = await Promise.all([
    import("@tanstack/react-router"),
    import("../../../router"),
  ]);
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe("projects screen", () => {
  it("renders the heading and a project row", async () => {
    server.use(
      http.get(PROJECTS_URL, () =>
        HttpResponse.json({
          projects: [
            {
              id: "proj_1",
              name: "River",
              created_at: "2026-07-08T09:00:00Z",
              updated_at: "2026-07-08T09:00:00Z",
            },
          ],
        }),
      ),
    );
    await renderProjects();

    expect(await screen.findByRole("heading", { name: "Projects" })).toBeInTheDocument();
    const table = within(await screen.findByRole("table"));
    expect(table.getByRole("link", { name: "River" })).toBeInTheDocument();
    expect(table.getByText(expectedDate("2026-07-08T09:00:00Z"))).toBeInTheDocument();
  });

  it("lists a project somebody else granted access to", async () => {
    // The person owns nothing here: the row exists only because the query
    // answers with grants rather than with the console's own project.
    server.use(
      http.get(PROJECTS_URL, () =>
        HttpResponse.json({
          projects: [
            {
              id: "proj_theirs",
              name: "Granted to me",
              created_at: "2026-07-08T09:00:00Z",
              updated_at: "2026-07-08T09:00:00Z",
            },
          ],
        }),
      ),
    );
    await renderProjects();

    const table = within(await screen.findByRole("table"));
    // A row opens the project — selects it and lands on its first screen —
    // rather than a detail page, as the switcher's rows do.
    expect(table.getByRole("link", { name: "Granted to me" })).toHaveAttribute(
      "href",
      "/?project=proj_theirs",
    );
  });

  it("never asks the scope-pinned project query", async () => {
    let pinned = 0;
    server.use(
      http.post("http://localhost/api/projects/query", () => {
        pinned += 1;
        return HttpResponse.json({ projects: [] });
      }),
      http.get(PROJECTS_URL, () => HttpResponse.json({ projects: [] })),
    );
    await renderProjects();

    expect(await screen.findByText("No projects yet.")).toBeInTheDocument();
    expect(pinned).toBe(0);
  });

  it("offers the project's settings from the row menu", async () => {
    server.use(
      http.get(PROJECTS_URL, () =>
        HttpResponse.json({
          projects: [
            {
              id: "proj_1",
              name: "River",
              created_at: "2026-07-08T09:00:00Z",
              updated_at: "2026-07-08T09:00:00Z",
            },
          ],
        }),
      ),
    );
    await renderProjects();

    await userEvent.click(await screen.findByRole("button", { name: "Actions for River" }));
    const item = await screen.findByRole("menuitem", { name: "Project settings" });
    expect(item).toHaveAttribute("href", "/project?project=proj_1");
  });

  it("asks for a selection while none is made", async () => {
    // Until a project is selected the sidebar lists only Projects, so this
    // page is the one that explains what to do. Two projects: with one, the
    // `_authed` guard would select it.
    server.use(
      http.get(PROJECTS_URL, () =>
        HttpResponse.json({
          projects: [
            {
              id: "proj_1",
              name: "River",
              created_at: "2026-07-08T09:00:00Z",
              updated_at: "2026-07-08T09:00:00Z",
            },
            {
              id: "proj_2",
              name: "Delta",
              created_at: "2026-07-08T09:00:00Z",
              updated_at: "2026-07-08T09:00:00Z",
            },
          ],
        }),
      ),
    );
    await renderProjects();

    expect(
      await screen.findByText("Select a project to manage its teams, users and login flows."),
    ).toBeInTheDocument();
  });

  it("sends a row back to the screen the guard sent here", async () => {
    server.use(
      http.get(PROJECTS_URL, () =>
        HttpResponse.json({
          projects: [
            {
              id: "proj_1",
              name: "River",
              created_at: "2026-07-08T09:00:00Z",
              updated_at: "2026-07-08T09:00:00Z",
            },
            {
              id: "proj_2",
              name: "Delta",
              created_at: "2026-07-08T09:00:00Z",
              updated_at: "2026-07-08T09:00:00Z",
            },
          ],
        }),
      ),
    );
    await renderProjects(`/projects?next=${encodeURIComponent("/teams?status=deactivated")}`);

    expect(await screen.findByRole("link", { name: "Delta" })).toHaveAttribute(
      "href",
      "/teams?status=deactivated&project=proj_2",
    );
  });

  it("ignores a next that leaves the console", async () => {
    server.use(
      http.get(PROJECTS_URL, () =>
        HttpResponse.json({
          projects: [
            {
              id: "proj_1",
              name: "River",
              created_at: "2026-07-08T09:00:00Z",
              updated_at: "2026-07-08T09:00:00Z",
            },
            {
              id: "proj_2",
              name: "Delta",
              created_at: "2026-07-08T09:00:00Z",
              updated_at: "2026-07-08T09:00:00Z",
            },
          ],
        }),
      ),
    );
    await renderProjects(`/projects?next=${encodeURIComponent("//evil.example/x")}`);

    expect(await screen.findByRole("link", { name: "Delta" })).toHaveAttribute(
      "href",
      "/?project=proj_2",
    );
  });

  it("says so when there are no projects", async () => {
    server.use(http.get(PROJECTS_URL, () => HttpResponse.json({ projects: [] })));
    await renderProjects();

    expect(await screen.findByText("No projects yet.")).toBeInTheDocument();
  });

  it("appends the next page and drops the button when the list is complete", async () => {
    // Keyed on the cursor rather than on call order: the shell's project pill
    // reads the same endpoint, so "the first call" is not reliably the loader's.
    const cursors: string[] = [];
    server.use(
      http.get(PROJECTS_URL, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get("page_token");
        if (cursor === null) {
          return HttpResponse.json({
            projects: [
              {
                id: "proj_1",
                name: "River",
                created_at: "2026-07-08T09:00:00Z",
                updated_at: "2026-07-08T09:00:00Z",
              },
            ],
            next_page_token: "page-2",
          });
        }
        cursors.push(cursor);
        return HttpResponse.json({
          projects: [
            {
              id: "proj_2",
              name: "Delta",
              created_at: "2026-07-09T09:00:00Z",
              updated_at: "2026-07-09T09:00:00Z",
            },
          ],
        });
      }),
    );
    await renderProjects();

    const loadMore = await screen.findByRole("button", { name: "Load more" });
    await userEvent.click(loadMore);

    expect(await screen.findByRole("link", { name: "Delta" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "River" })).toBeInTheDocument();
    // The cursor rides as a query parameter now that the read is a GET.
    expect(cursors).toEqual(["page-2"]);
    // Absent rather than disabled: its absence is how the screen says the list
    // is complete (design decisions log D5 — no total count to show instead).
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });
});

describe("projects screen in platform mode", () => {
  const EU = { id: "eu", name: "EU (Frankfurt)", api_base: "/eu" };
  const US = { id: "us", name: "US (Ohio)", api_base: "/us" };
  const row = (id: string, name: string) => ({
    id,
    name,
    created_at: "2026-07-08T09:00:00Z",
    updated_at: "2026-07-08T09:00:00Z",
  });

  beforeEach(() => {
    _setRuntimeForTesting({
      mode: "platform",
      console_project_id: "proj_platform",
      regions: [EU, US],
    });
  });
  afterEach(() => _resetRuntimeForTesting());

  it("lists the projects of every region with their region", async () => {
    server.use(
      http.get("http://localhost/api/eu/users/me/projects", () =>
        HttpResponse.json({ projects: [row("proj_eu", "River")] }),
      ),
      http.get("http://localhost/api/us/users/me/projects", () =>
        HttpResponse.json({ projects: [row("proj_us", "Delta")] }),
      ),
    );
    await renderProjects();

    const table = within(await screen.findByRole("table"));
    expect(table.getByRole("link", { name: "River" })).toBeInTheDocument();
    expect(table.getByText("EU (Frankfurt)")).toBeInTheDocument();
    expect(table.getByRole("link", { name: "Delta" })).toBeInTheDocument();
    expect(table.getByText("US (Ohio)")).toBeInTheDocument();
  });

  it("names a region it could not list and shows the rest", async () => {
    server.use(
      http.get("http://localhost/api/eu/users/me/projects", () =>
        HttpResponse.json({ projects: [row("proj_eu", "River")] }),
      ),
      http.get("http://localhost/api/us/users/me/projects", () =>
        HttpResponse.json({ code: "internal", message: "down" }, { status: 500 }),
      ),
    );
    await renderProjects();

    expect(
      await screen.findByText("Could not list the projects in US (Ohio)."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "River" })).toBeInTheDocument();
  });

  it("creates a project in the chosen region and claims it", async () => {
    const calls: string[] = [];
    server.use(
      http.get("http://localhost/api/eu/users/me/projects", () =>
        HttpResponse.json({ projects: [] }),
      ),
      http.get("http://localhost/api/us/users/me/projects", () =>
        HttpResponse.json({ projects: [] }),
      ),
      http.post("http://localhost/api/eu/projects", async ({ request }) => {
        const body = (await request.json()) as { name: string };
        calls.push(`create ${body.name}`);
        return HttpResponse.json(
          {
            id: "proj_new",
            name: body.name,
            project_secret: "secret_once",
            preview_secret: "pk_new",
            preview_origins: [],
            created_at: "2026-10-10T00:00:00Z",
          },
          { status: 201 },
        );
      }),
      http.post("http://localhost/api/eu/projects/proj_new/claim/init", ({ request }) => {
        calls.push(`init ${request.headers.get("authorization")}`);
        return HttpResponse.json(
          {
            claim_url: "http://localhost/console/claim?c=c1",
            challenge_id: "c1",
            expires_at: "2100-01-01T00:00:00Z",
          },
          { status: 201 },
        );
      }),
      http.post("http://localhost/api/eu/projects/proj_new/claim/complete", async ({ request }) => {
        const body = (await request.json()) as { challenge_id: string };
        calls.push(`complete ${body.challenge_id}`);
        return HttpResponse.json({
          project_id: "proj_new",
          team_id: "team_1",
          claimed_at: "2026-10-10T00:00:00Z",
        });
      }),
    );
    await renderProjects();

    await userEvent.click(await screen.findByRole("button", { name: "New project" }));
    await userEvent.type(await screen.findByLabelText("Name"), "Riverbed");
    await userEvent.click(screen.getByRole("button", { name: "Create project" }));

    expect(await screen.findByText("Project created in EU (Frankfurt).")).toBeInTheDocument();
    // The public create, the challenge with the one-time secret, the
    // completion with the session: all in the chosen region.
    expect(calls).toEqual(["create Riverbed", "init Bearer secret_once", "complete c1"]);
  });
});
