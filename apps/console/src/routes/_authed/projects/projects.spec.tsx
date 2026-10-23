import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { _setRuntimeForTesting } from "@/runtime/runtime";
import { server } from "@/test/msw";

// The `_authed` layout guards every screen behind `GET /sessions/me`
// (Console ADR 0003); mock the auth module so routes render as signed in.
vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  const { makeTestSession } = await import("@/test/session.fixture");
  return { ...actual, fetchSession: vi.fn(async () => makeTestSession()) };
});

// `GET /users/me/projects`: the projects the signed-in person can act on, read
// with the session cookie (#1237). Not `POST /projects/query`, which the server
// pins to the calling credential's one home project.
const PROJECTS_URL = "http://localhost/api/users/me/projects";

/** A project as `GET /users/me/projects` lists it. */
function listed(id: string, name: string) {
  return { id, name, created_at: "2026-07-08T09:00:00Z", updated_at: "2026-07-08T09:00:00Z" };
}

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

  it("opens New project on setup against this console's own server", async () => {
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

    await userEvent.click(await screen.findByRole("button", { name: "New project" }));
    const drawer = within(await screen.findByRole("dialog", { name: "New project" }));
    // The specs' API base is http://localhost/api, so that is the server the
    // command names, not the CLI's hosted default.
    expect(
      drawer.getByText("npx @zitadel/cli@latest setup --server http://localhost"),
    ).toBeInTheDocument();
    expect(drawer.getByRole("button", { name: "Copy the setup command" })).toBeInTheDocument();
  });

  it("tells projects of one name apart by their host and id", async () => {
    server.use(
      http.get(PROJECTS_URL, () =>
        HttpResponse.json({
          projects: [
            // The local machine tells no project apart, so it shows no host.
            {
              ...listed("proj_1", "maxtest1"),
              origins: [{ pattern: "http://localhost:3000", kind: "primary" }],
            },
            // A preview pattern names no host; the primary origin does.
            {
              ...listed("proj_2", "maxtest1"),
              origins: [
                { pattern: "https://*.preview.example.com", kind: "preview" },
                { pattern: "https://shop.example.com", kind: "primary" },
              ],
            },
          ],
        }),
      ),
    );
    await renderProjects();

    const table = within(await screen.findByRole("table"));
    // Below the header row; two of one name keep their places by id.
    const [first, second] = table.getAllByRole("row").slice(1) as [HTMLElement, HTMLElement];
    expect(within(first).getByText("proj_1")).toBeInTheDocument();
    expect(within(first).queryByText(/localhost/)).not.toBeInTheDocument();
    expect(within(second).getByText("proj_2")).toBeInTheDocument();
    expect(within(second).getByText("shop.example.com")).toBeInTheDocument();
    expect(table.getAllByRole("button", { name: "Copy the ID of maxtest1" })).toHaveLength(2);
  });

  it("marks the selected project, which the bar does not name here", async () => {
    server.use(
      http.get(PROJECTS_URL, () =>
        HttpResponse.json({ projects: [listed("proj_1", "River"), listed("proj_2", "Delta")] }),
      ),
    );
    await renderProjects("/projects?project=proj_2");

    const table = within(await screen.findByRole("table"));
    const current = (await table.findByText("Current")).closest("tr") as HTMLElement;
    expect(within(current).getByRole("link", { name: "Delta" })).toBeInTheDocument();
    expect(table.getAllByText("Current")).toHaveLength(1);
    // The list is the switcher here (D21).
    expect(screen.queryByRole("button", { name: "Switch project" })).not.toBeInTheDocument();
  });

  it("lists the projects by name while they fit on one page", async () => {
    // By id, the server's order, `proj_platform` sorts after every generated id.
    server.use(
      http.get(PROJECTS_URL, () =>
        HttpResponse.json({
          projects: [
            listed("proj_1", "zeta"),
            listed("proj_2", "app-10"),
            listed("proj_3", "app-2"),
            listed("proj_platform", "Platform"),
          ],
        }),
      ),
    );
    await renderProjects();

    const table = within(await screen.findByRole("table"));
    expect(table.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "app-2",
      "app-10",
      "Platform",
      "zeta",
    ]);
  });

  it("keeps the server's order past one page", async () => {
    // A page sorted among itself would put rows Load more appends out of place.
    server.use(
      http.get(PROJECTS_URL, () =>
        HttpResponse.json({
          projects: [listed("proj_1", "zeta"), listed("proj_2", "alpha")],
          next_page_token: "page-2",
        }),
      ),
    );
    await renderProjects();

    const table = within(await screen.findByRole("table"));
    await table.findByRole("link", { name: "zeta" });
    expect(table.getAllByRole("link").map((link) => link.textContent)).toEqual(["zeta", "alpha"]);
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
    // Until a project is selected the project's screens ask for one first, so
    // this page says what choosing one is for. Two projects: with one, the
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

    // On the way to Teams, the page is named for it (D22).
    expect(await screen.findByRole("heading", { name: "Continue to Teams" })).toBeInTheDocument();
    expect(await screen.findByText("Choose a project to continue.")).toBeInTheDocument();
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
    // Nothing to search, while New project stays.
    expect(screen.queryByRole("searchbox", { name: "Search projects" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New project" })).toBeInTheDocument();
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

  it("offers the search however few projects there are", async () => {
    server.use(
      http.get(PROJECTS_URL, () => HttpResponse.json({ projects: [listed("proj_1", "River")] })),
    );
    await renderProjects();

    expect(await screen.findByRole("link", { name: "River" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search projects" })).toBeInTheDocument();
  });

  it("searches every project on the server once the list runs past one page", async () => {
    const searched: URLSearchParams[] = [];
    server.use(
      http.get(PROJECTS_URL, ({ request }) => {
        const params = new URL(request.url).searchParams;
        if (!params.has("name_contains")) {
          return HttpResponse.json({
            projects: [listed("proj_1", "River"), listed("proj_2", "Delta")],
            next_page_token: "page-2",
          });
        }
        searched.push(params);
        // Past the loaded rows: only the server can find it.
        return HttpResponse.json({ projects: [listed("proj_9", "Zephyr")] });
      }),
    );
    const router = await renderProjects();

    await userEvent.type(await screen.findByRole("searchbox", { name: "Search projects" }), "zep");

    expect(await screen.findByRole("link", { name: "Zephyr" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "River" })).not.toBeInTheDocument();
    // One read per pause in typing, at the screen's page size.
    expect(searched.map((params) => [params.get("name_contains"), params.get("limit")])).toEqual([
      ["zep", "25"],
    ]);
    // The search is in the URL, and the screen's own navigation leaves the
    // field as it was typed.
    await waitFor(() => expect(router.state.resolvedLocation?.search).toMatchObject({ q: "zep" }));
    expect(screen.getByRole("searchbox", { name: "Search projects" })).toHaveValue("zep");
  });

  it("keeps the field while a cleared search reloads the list", async () => {
    // A short list opened on a search: clearing it drops `?q=`, and the field
    // stays rather than leaving with it.
    server.use(
      http.get(PROJECTS_URL, () => HttpResponse.json({ projects: [listed("proj_1", "River")] })),
    );
    const router = await renderProjects("/projects?q=riv");

    const field = await screen.findByRole("searchbox", { name: "Search projects" });
    await userEvent.clear(field);

    await waitFor(() => expect(router.state.resolvedLocation?.search.q).toBeUndefined());
    expect(screen.getByRole("searchbox", { name: "Search projects" })).toHaveValue("");
    expect(screen.getByRole("link", { name: "River" })).toBeInTheDocument();
  });

  it("keeps the search when loading more", async () => {
    const reads: URLSearchParams[] = [];
    server.use(
      http.get(PROJECTS_URL, ({ request }) => {
        const params = new URL(request.url).searchParams;
        reads.push(params);
        if (params.get("page_token") === "zep-2") {
          return HttpResponse.json({ projects: [listed("proj_10", "Zephyr Two")] });
        }
        return HttpResponse.json({
          projects: [listed("proj_9", "Zephyr")],
          next_page_token: "zep-2",
        });
      }),
    );
    await renderProjects("/projects?q=zep");

    expect(await screen.findByRole("searchbox", { name: "Search projects" })).toHaveValue("zep");
    await userEvent.click(await screen.findByRole("button", { name: "Load more" }));
    expect(await screen.findByRole("link", { name: "Zephyr Two" })).toBeInTheDocument();

    // The loader's read and Load more both carry the search: a page token
    // continues the list it came from.
    const searched = reads.filter((params) => params.get("limit") === "25");
    expect(searched.map((params) => params.get("name_contains"))).toEqual(["zep", "zep"]);
    expect(searched.map((params) => params.get("page_token"))).toEqual([null, "zep-2"]);
  });

  it("says when a search matches nothing", async () => {
    server.use(
      http.get(PROJECTS_URL, ({ request }) =>
        HttpResponse.json(
          new URL(request.url).searchParams.has("name_contains")
            ? { projects: [] }
            : { projects: [listed("proj_1", "River")], next_page_token: "page-2" },
        ),
      ),
    );
    await renderProjects("/projects?q=zzz");

    expect(await screen.findByText("No projects match “zzz”.")).toBeInTheDocument();
  });

  it("clears the search when Projects is opened from the sidebar", async () => {
    server.use(
      http.get(PROJECTS_URL, () =>
        HttpResponse.json({
          projects: [listed("proj_1", "River"), listed("proj_2", "Delta")],
          next_page_token: "page-2",
        }),
      ),
    );
    const router = await renderProjects("/projects?q=zep");
    expect(await screen.findByRole("searchbox", { name: "Search projects" })).toHaveValue("zep");

    const nav = within(screen.getByRole("navigation", { name: "Primary" }));
    await userEvent.click(nav.getByRole("link", { name: "Projects" }));

    await waitFor(() => expect(router.state.resolvedLocation?.search.q).toBeUndefined());
    await waitFor(() =>
      expect(screen.getByRole("searchbox", { name: "Search projects" })).toHaveValue(""),
    );
  });

  // On localhost the cookie may hold an app's session. Every read of the list
  // names the console's project, so the server refuses that session instead of
  // listing the app user's projects.
  it("names the console's project in every read of the list", async () => {
    _setRuntimeForTesting({ mode: "standalone", console_project_id: "proj_platform" });
    const reads: URLSearchParams[] = [];
    server.use(
      http.get(PROJECTS_URL, ({ request }) => {
        const params = new URL(request.url).searchParams;
        reads.push(params);
        const id = params.get("page_token") === null ? "proj_1" : "proj_2";
        return HttpResponse.json({
          projects: [
            {
              id,
              name: id === "proj_1" ? "River" : "Delta",
              created_at: "2026-07-08T09:00:00Z",
              updated_at: "2026-07-08T09:00:00Z",
            },
          ],
          next_page_token: id === "proj_1" ? "page-2" : undefined,
        });
      }),
    );
    await renderProjects();
    await userEvent.click(await screen.findByRole("button", { name: "Load more" }));
    expect(await screen.findByRole("link", { name: "Delta" })).toBeInTheDocument();

    // The guard's and the switcher's shared read, the screen's and Load more.
    expect(reads.some((params) => !params.has("limit"))).toBe(true);
    expect(reads.some((params) => params.get("page_token") === "page-2")).toBe(true);
    expect(reads.map((params) => params.get("project_id"))).toEqual(
      reads.map(() => "proj_platform"),
    );
  });
});
