import { render, screen, waitFor, within } from "@testing-library/react";
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

// `GET /users/me/projects`: the projects the signed-in person can act on, read
// with the session cookie (root ADR 053 §6). The screen renders one section per
// project it returns (#1238) — never the console's own platform project.
const PROJECTS_URL = "http://localhost/api/users/me/projects";
const GRANTS_URL = "http://localhost/api/grants";
const GRANTS_QUERY_URL = `${GRANTS_URL}/query`;
const USERS_QUERY_URL = "http://localhost/api/users/query";
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => {
  server.close();
  vi.unstubAllEnvs();
});

async function renderAdmins() {
  const [{ RouterProvider, createMemoryHistory }, { createAppRouter }] = await Promise.all([
    import("@tanstack/react-router"),
    import("../../../router"),
  ]);
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: ["/settings/admins"] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

function project(id: string, name: string) {
  return { id, name, created_at: "2026-07-08T09:00:00Z", updated_at: "2026-07-08T09:00:00Z" };
}

function grant(overrides: Record<string, unknown> = {}) {
  return {
    id: "asgn_1",
    project_id: "proj_1",
    object_type: "project",
    relation: "admin",
    created_at: "2026-09-01T10:00:00Z",
    user: { user_id: "user_1" },
    ...overrides,
  };
}

/**
 * A user as `expand: ["principal"]` inlines it: extras live on the same
 * `user` object as the ref (`user_id`, never `id`).
 */
function grantUser(identity: Record<string, unknown>) {
  return {
    user_id: "user_1",
    schema: "sch_1",
    attributes: {},
    metadata: {
      created_at: "2026-09-01T10:00:00Z",
      updated_at: "2026-09-01T10:00:00Z",
      status: "active",
    },
    ...identity,
  };
}

function stubProjects(...projects: Record<string, unknown>[]) {
  server.use(http.get(PROJECTS_URL, () => HttpResponse.json({ projects })));
}

/** One `POST /grants/query` as the screen sends it: which project, and what body. */
interface GrantsQuery {
  projectId: string | null;
  body: Record<string, unknown>;
}

/**
 * Grants per project id. Records every `POST /grants/query`, so both the
 * project each request was scoped to and the expansion sent can be asserted.
 */
function stubGrants(byProject: Record<string, Record<string, unknown>[]>) {
  const queries: GrantsQuery[] = [];
  server.use(
    http.post(GRANTS_QUERY_URL, async ({ request }) => {
      const projectId = new URL(request.url).searchParams.get("project_id");
      queries.push({ projectId, body: (await request.json()) as Record<string, unknown> });
      return HttpResponse.json({ grants: byProject[projectId ?? ""] ?? [] });
    }),
  );
  return queries;
}

/** The owner's case: one claimed project, `proj_1` ("Acme"), holding these grants. */
function stubOwnerProject(...grants: Record<string, unknown>[]) {
  stubProjects(project("proj_1", "Acme"));
  return stubGrants({ proj_1: grants });
}

describe("admins screen", () => {
  it("shows one section per project the person can act on", async () => {
    // Each section is scoped to its own project: the grants query carries that
    // project's id, and the rows land under the project they belong to.
    stubProjects(project("proj_1", "Acme"), project("proj_2", "Beacon"));
    const queries = stubGrants({
      proj_1: [grant({ user: grantUser({ display: "Maya Patel" }) })],
      proj_2: [
        grant({ id: "asgn_2", user: grantUser({ user_id: "user_2", display: "Sol Reyes" }) }),
      ],
    });
    await renderAdmins();

    const acme = within(await screen.findByRole("region", { name: "Acme" }));
    const beacon = within(await screen.findByRole("region", { name: "Beacon" }));
    expect(acme.getByText("Maya Patel")).toBeInTheDocument();
    expect(acme.queryByText("Sol Reyes")).not.toBeInTheDocument();
    expect(beacon.getByText("Sol Reyes")).toBeInTheDocument();
    expect(queries.map((query) => query.projectId).sort()).toEqual(["proj_1", "proj_2"]);
  });

  it("shows the granter's project to the person who was granted access", async () => {
    // The person owns nothing: the section exists because somebody granted
    // them access to their project, and they see themselves in it.
    stubProjects(project("proj_theirs", "Granted to me"));
    const queries = stubGrants({
      proj_theirs: [
        grant({
          project_id: "proj_theirs",
          user: grantUser({ user_id: "user_test", identifier: "test.user@example.com" }),
        }),
      ],
    });
    await renderAdmins();

    const section = within(await screen.findByRole("region", { name: "Granted to me" }));
    expect(section.getByText("test.user@example.com")).toBeInTheDocument();
    expect(queries.map((query) => query.projectId)).toEqual(["proj_theirs"]);
  });

  it("says so when the person can act on no project", async () => {
    // Nothing to list, and nothing to ask: with no project there is no grants
    // query to send — in particular not one for the console's platform project.
    stubProjects();
    const queries = stubGrants({});
    await renderAdmins();

    expect(await screen.findByText("No projects yet.")).toBeInTheDocument();
    // No section at all — not an empty one for the console's own project.
    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add admin" })).not.toBeInTheDocument();
    expect(queries).toEqual([]);
  });

  it("asks for the principal and labels each grant with it", async () => {
    // One request per project, not a read per row: the principal rides along on
    // the list (ADR 059), and ADR 058's resolved identity is what the row shows.
    const queries = stubOwnerProject(
      grant({ user: grantUser({ display: "Maya Patel", identifier: "maya@acme.com" }) }),
      grant({
        id: "asgn_2",
        user: grantUser({ user_id: "user_2", identifier: "sol@acme.com" }),
      }),
    );
    await renderAdmins();

    const table = within(await screen.findByRole("table"));
    expect(queries).toHaveLength(1);
    expect(queries[0]?.body).toMatchObject({ expand: ["principal"] });
    expect(table.getByText("Maya Patel")).toBeInTheDocument();
    // No display designated, so the identifier is the label rather than the id.
    expect(table.getByText("sol@acme.com")).toBeInTheDocument();
  });

  it("falls back to the principal id when the principal cannot be loaded", async () => {
    // A deleted user's surviving grant is a degraded ref: `user_id` only.
    stubOwnerProject(grant({ user: { user_id: "user_1" } }));
    await renderAdmins();

    const table = within(await screen.findByRole("table"));
    expect(table.getByText("user_1")).toBeInTheDocument();
  });

  it("renders whatever relation a grant carries, not just admin", async () => {
    // The screen only creates `admin`, but the catalog has three relations and
    // a grant made elsewhere must not be mislabelled.
    stubOwnerProject(grant({ relation: "viewer", user: grantUser({ identifier: "vi@acme.com" }) }));
    await renderAdmins();

    const table = within(await screen.findByRole("table"));
    expect(table.getByText("Viewer")).toBeInTheDocument();
  });

  it("labels a team principal by its name", async () => {
    // A team grant carries `team` and omits `user`. `name` is already on the ref.
    stubOwnerProject(
      grant({
        user: undefined,
        team: {
          team_id: "team_1",
          name: "Platform",
          status: "active",
          created_at: "2026-09-01T10:00:00Z",
          updated_at: "2026-09-01T10:00:00Z",
        },
      }),
    );
    await renderAdmins();

    const table = within(await screen.findByRole("table"));
    expect(table.getByText("Platform")).toBeInTheDocument();
  });

  it("says so when nobody has been granted access to a project", async () => {
    // Right after claiming: the owner's access comes through the owning team,
    // not an admin grant, so their own project lists nobody. That is correct.
    stubOwnerProject();
    await renderAdmins();

    const section = within(await screen.findByRole("region", { name: "Acme" }));
    expect(await section.findByText("No admins yet.")).toBeInTheDocument();
    expect(section.getByRole("button", { name: "Add admin" })).toBeInTheDocument();
  });

  it("adds an existing person as an admin of the section's project", async () => {
    // Two projects, so a grant created from the second section proves the id
    // comes from the section rather than from the first (or the console's own)
    // project.
    stubProjects(project("proj_1", "Acme"), project("proj_2", "Beacon"));
    stubGrants({});
    server.use(
      http.post(USERS_QUERY_URL, () =>
        HttpResponse.json({
          users: [
            {
              id: "user_9",
              identifier: "colleague@acme.com",
              identifier_property: "email",
              display: "Colleague",
              attributes: { email: "colleague@acme.com" },
            },
          ],
        }),
      ),
    );
    let created: { projectId: string | null; body: Record<string, unknown> } | undefined;
    server.use(
      http.post(GRANTS_URL, async ({ request }) => {
        created = {
          projectId: new URL(request.url).searchParams.get("project_id"),
          body: (await request.json()) as Record<string, unknown>,
        };
        return HttpResponse.json({ id: "asgn_new" }, { status: 201 });
      }),
    );
    await renderAdmins();

    const beacon = within(await screen.findByRole("region", { name: "Beacon" }));
    await userEvent.click(beacon.getByRole("button", { name: "Add admin" }));
    await userEvent.click(await screen.findByRole("combobox", { name: "Person" }));
    await userEvent.click(await screen.findByRole("option", { name: /Colleague/ }));
    // The dialog's own submit, not the trigger that shares its label.
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Add admin" }),
    );

    // Bound to the person, on the section's project, at the only level this
    // journey grants (#769).
    await waitFor(() =>
      expect(created).toEqual({
        projectId: "proj_2",
        body: { user: { user_id: "user_9" }, relation: "admin" },
      }),
    );
  });

  it("does not offer people who are already admins of that project", async () => {
    // `POST /grants` refuses a second grant for the same principal and relation,
    // so offering them would be offering a choice that cannot work.
    stubProjects(project("proj_1", "Acme"), project("proj_2", "Beacon"));
    stubGrants({ proj_1: [grant({ user: grantUser({ user_id: "user_9" }) })] });
    server.use(
      http.post(USERS_QUERY_URL, () =>
        HttpResponse.json({
          users: [
            { id: "user_9", identifier: "already@acme.com" },
            { id: "user_8", identifier: "free@acme.com" },
          ],
        }),
      ),
    );
    await renderAdmins();

    const acme = within(await screen.findByRole("region", { name: "Acme" }));
    await userEvent.click(acme.getByRole("button", { name: "Add admin" }));
    await userEvent.click(await screen.findByRole("combobox", { name: "Person" }));

    expect(await screen.findByRole("option", { name: /free@acme.com/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /already@acme.com/ })).not.toBeInTheDocument();
  });

  it("still offers an admin of one project to another", async () => {
    // The exclusion is per project: holding `admin` on Acme says nothing about
    // Beacon, where the same person is still a real choice.
    stubProjects(project("proj_1", "Acme"), project("proj_2", "Beacon"));
    stubGrants({ proj_1: [grant({ user: grantUser({ user_id: "user_9" }) })] });
    server.use(
      http.post(USERS_QUERY_URL, () =>
        HttpResponse.json({ users: [{ id: "user_9", identifier: "already@acme.com" }] }),
      ),
    );
    await renderAdmins();

    const beacon = within(await screen.findByRole("region", { name: "Beacon" }));
    await userEvent.click(beacon.getByRole("button", { name: "Add admin" }));
    await userEvent.click(await screen.findByRole("combobox", { name: "Person" }));

    expect(await screen.findByRole("option", { name: /already@acme.com/ })).toBeInTheDocument();
  });

  it("still offers someone who only holds a lesser relation", async () => {
    // A viewer can be made an admin: the refusal is per principal *and*
    // relation, so filtering on the principal alone would hide a real choice.
    stubOwnerProject(
      grant({
        relation: "viewer",
        user: grantUser({ user_id: "user_9" }),
      }),
    );
    server.use(
      http.post(USERS_QUERY_URL, () =>
        HttpResponse.json({ users: [{ id: "user_9", identifier: "viewer@acme.com" }] }),
      ),
    );
    await renderAdmins();

    await userEvent.click(await screen.findByRole("button", { name: "Add admin" }));
    await userEvent.click(await screen.findByRole("combobox", { name: "Person" }));

    expect(await screen.findByRole("option", { name: /viewer@acme.com/ })).toBeInTheDocument();
  });

  it("surfaces the API's own message when the grant is refused", async () => {
    // ADR 030 makes the payload's `message` the human-facing string, so a
    // duplicate binding explains itself rather than getting console-authored copy.
    stubOwnerProject();
    server.use(
      http.post(USERS_QUERY_URL, () =>
        HttpResponse.json({ users: [{ id: "user_9", identifier: "dupe@acme.com" }] }),
      ),
      http.post(GRANTS_URL, () =>
        HttpResponse.json(
          { code: "grant.already_exists", message: "This principal already has that access." },
          { status: 409 },
        ),
      ),
    );
    await renderAdmins();

    await userEvent.click(await screen.findByRole("button", { name: "Add admin" }));
    await userEvent.click(await screen.findByRole("combobox", { name: "Person" }));
    await userEvent.click(await screen.findByRole("option", { name: /dupe@acme.com/ }));
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Add admin" }),
    );

    expect(await screen.findByText("This principal already has that access.")).toBeInTheDocument();
  });

  it("names the relation the row holds, not always admin", async () => {
    // The screen only creates `admin`, but the list shows whatever a grant
    // carries, and "Remove admin" over a `viewer` row would misdescribe the
    // click.
    stubOwnerProject(grant({ relation: "viewer", user: grantUser({ display: "Sasha Kim" }) }));
    await renderAdmins();

    await userEvent.click(await screen.findByRole("button", { name: "Actions for Sasha Kim" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Remove viewer" }));
    const dialog = within(await screen.findByRole("alertdialog"));
    expect(dialog.getByText("Remove viewer?")).toBeInTheDocument();
  });

  it("does not carry a failed removal into the next opening", async () => {
    // The dialog content is mounted per opening, so the error from one attempt
    // is not sitting there when the operator opens it again.
    stubOwnerProject(grant({ user: grantUser({ display: "Maya Patel" }) }));
    server.use(
      http.delete(`${GRANTS_URL}/:id`, () =>
        HttpResponse.json({ code: "grant.not_found", message: "no such grant" }, { status: 404 }),
      ),
    );
    await renderAdmins();

    await userEvent.click(await screen.findByRole("button", { name: "Actions for Maya Patel" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Remove admin" }));
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Remove admin" }),
    );
    expect(await screen.findByText("no such grant")).toBeInTheDocument();

    await userEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Actions for Maya Patel" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Remove admin" }));

    await screen.findByRole("alertdialog");
    expect(screen.queryByText("no such grant")).not.toBeInTheDocument();
  });

  it("says the list could not be loaded rather than that everyone is an admin", async () => {
    // Both cases leave the picker empty; only one of them is the operator's to
    // act on.
    stubOwnerProject();
    server.use(
      http.post(USERS_QUERY_URL, () =>
        HttpResponse.json({ code: "internal", message: "boom" }, { status: 500 }),
      ),
    );
    await renderAdmins();

    await userEvent.click(await screen.findByRole("button", { name: "Add admin" }));
    await userEvent.click(await screen.findByRole("combobox", { name: "Person" }));

    expect(
      await screen.findByText("The people on this project could not be loaded."),
    ).toBeInTheDocument();
  });

  it("removes an admin from the section's project after confirming", async () => {
    // The revoke is scoped like the read: `DELETE /grants/{id}` carries the
    // project the section belongs to, not the console's own project.
    stubProjects(project("proj_1", "Acme"), project("proj_2", "Beacon"));
    stubGrants({
      proj_2: [
        grant({ id: "asgn_2", project_id: "proj_2", user: grantUser({ display: "Maya Patel" }) }),
      ],
    });
    let deleted: { id: string; projectId: string | null } | undefined;
    server.use(
      http.delete(`${GRANTS_URL}/:id`, ({ params, request }) => {
        deleted = {
          id: params.id as string,
          projectId: new URL(request.url).searchParams.get("project_id"),
        };
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await renderAdmins();

    await userEvent.click(await screen.findByRole("button", { name: "Actions for Maya Patel" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Remove admin" }));
    const dialog = within(await screen.findByRole("alertdialog"));
    expect(dialog.getByText("Remove admin?")).toBeInTheDocument();
    await userEvent.click(dialog.getByRole("button", { name: "Remove admin" }));

    await waitFor(() => expect(deleted).toEqual({ id: "asgn_2", projectId: "proj_2" }));
  });

  it("keeps the row when the removal is cancelled", async () => {
    stubOwnerProject(grant({ user: grantUser({ display: "Maya Patel" }) }));
    let deleteCalls = 0;
    server.use(
      http.delete(`${GRANTS_URL}/:id`, () => {
        deleteCalls += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await renderAdmins();

    await userEvent.click(await screen.findByRole("button", { name: "Actions for Maya Patel" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Remove admin" }));
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }),
    );

    expect(deleteCalls).toBe(0);
    expect(screen.getByText("Maya Patel")).toBeInTheDocument();
  });
});

describe("settings nav", () => {
  it("lists Admins under WORKSPACE", async () => {
    stubOwnerProject();
    await renderAdmins();

    const workspace = await screen.findByRole("navigation", { name: "WORKSPACE" });
    expect(within(workspace).getByRole("link", { name: /Admins/ })).toHaveAttribute(
      "href",
      "/settings/admins",
    );
    // `ACCOUNT` has no built screen yet, so its heading is not drawn: a heading
    // over nothing advertises a section that is not there.
    expect(screen.queryByRole("navigation", { name: "ACCOUNT" })).not.toBeInTheDocument();
  });

  it("keeps Admins out of the portal sidebar", async () => {
    // Rendered on a portal URL, where the primary list is the one on screen —
    // asserting this from a settings URL would pass whether or not the two
    // views are actually separated.
    const [{ RouterProvider, createMemoryHistory }, { createAppRouter }] = await Promise.all([
      import("@tanstack/react-router"),
      import("../../../router"),
    ]);
    stubProjects();
    render(
      <RouterProvider
        router={createAppRouter({ history: createMemoryHistory({ initialEntries: ["/teams"] }) })}
      />,
    );

    const primary = await screen.findByRole("navigation", { name: "Primary" });
    expect(within(primary).queryByRole("link", { name: /Admins/ })).not.toBeInTheDocument();
  });
});
