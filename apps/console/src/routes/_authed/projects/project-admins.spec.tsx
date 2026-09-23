import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Safe as a static import where `@/auth/session` is not: the fixture's only
// dependency on it is a type, which the transform erases.
import { makeTestSession } from "@/auth/session.fixture";

// The `_authed` layout guards every screen behind `GET /sessions/me`
// (Console ADR 0003); mock the auth module so routes render as signed in.
vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  const { makeTestSession } = await import("@/auth/session.fixture");
  return { ...actual, fetchSession: vi.fn(async () => makeTestSession()) };
});

vi.stubEnv("VITE_CONSOLE_API_BASE", "http://localhost/api");

// Loaded after the env stub, for the same reason `renderProject` imports the
// router dynamically: the API client reads its base once, at module load, and a
// static import would run before the stub and send every request to port 3000.
const { NEUTRAL_MESSAGE, SELF_MESSAGE } = await import("@/components/add-admin-dialog");

/**
 * The admins section of the project page (#1238). Grants are project-level
 * data: the section reads, adds and removes against the route's project id,
 * never the console's own (platform) project.
 */
const PROJECT_ID = "proj_1";
const PROJECTS_URL = "http://localhost/api/projects";
const GRANTS_URL = "http://localhost/api/grants";
const GRANTS_QUERY_URL = `${GRANTS_URL}/query`;
const USERS_QUERY_URL = "http://localhost/api/users/query";
/** The signed-in address, read from the fixture rather than restated here. */
const SELF = makeTestSession().user?.identifier ?? "";
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => {
  server.close();
  vi.unstubAllEnvs();
});

async function renderProject(projectId = PROJECT_ID) {
  const [{ RouterProvider, createMemoryHistory }, { createAppRouter }] = await Promise.all([
    import("@tanstack/react-router"),
    import("../../../router"),
  ]);
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [`/projects/${projectId}`] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

function project(id = PROJECT_ID, name = "Acme") {
  return { id, name, created_at: "2026-07-08T09:00:00Z", updated_at: "2026-07-08T09:00:00Z" };
}

function grant(overrides: Record<string, unknown> = {}) {
  return {
    id: "asgn_1",
    project_id: PROJECT_ID,
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

/** One `POST /grants/query` as the section sends it: which project, and what body. */
interface GrantsQuery {
  projectId: string | null;
  body: Record<string, unknown>;
}

/**
 * The project and its grants. Records every `POST /grants/query`, so both the
 * project each request was scoped to and the expansion sent can be asserted.
 */
function stubProject(grants: Record<string, unknown>[], record = project()) {
  const queries: GrantsQuery[] = [];
  server.use(
    http.get(`${PROJECTS_URL}/:id`, () => HttpResponse.json(record)),
    http.post(GRANTS_QUERY_URL, async ({ request }) => {
      const projectId = new URL(request.url).searchParams.get("project_id");
      queries.push({ projectId, body: (await request.json()) as Record<string, unknown> });
      return HttpResponse.json({ grants });
    }),
  );
  return queries;
}

/** One `POST /grants` as the dialog sends it: which project, and what body. */
interface GrantCreate {
  projectId: string | null;
  body: unknown;
}

/**
 * `POST /grants` by identifier: 202 with no body, whoever the address belongs
 * to (#1229). The returned array is every request the console sent.
 */
function stubCreateGrant() {
  const created: GrantCreate[] = [];
  server.use(
    http.post(GRANTS_URL, async ({ request }) => {
      created.push({
        projectId: new URL(request.url).searchParams.get("project_id"),
        body: await request.json(),
      });
      return new HttpResponse(null, { status: 202 });
    }),
  );
  return created;
}

function admins() {
  return within(screen.getByRole("region", { name: "Admins" }));
}

async function openAddAdmin() {
  await screen.findByRole("region", { name: "Admins" });
  await userEvent.click(admins().getByRole("button", { name: "Add admin" }));
  const dialog = within(await screen.findByRole("dialog"));
  return {
    dialog,
    input: dialog.getByRole("textbox", { name: "Email address" }),
    // The dialog's own submit, not the trigger that shares its label.
    submit: dialog.getByRole("button", { name: "Add admin" }),
  };
}

describe("project admins", () => {
  it("reads the grants of the route's project, with their principals", async () => {
    // One request, scoped to the project on the URL — not to the console's own
    // project — and not a read per row: the principal rides along on the list
    // (ADR 059), and ADR 058's resolved identity is what the row shows.
    const queries = stubProject([
      grant({ user: grantUser({ display: "Maya Patel", identifier: "maya@acme.com" }) }),
      grant({ id: "asgn_2", user: grantUser({ user_id: "user_2", identifier: "sol@acme.com" }) }),
    ]);
    await renderProject();

    const section = within(await screen.findByRole("region", { name: "Admins" }));
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatchObject({ projectId: PROJECT_ID, body: { expand: ["principal"] } });
    expect(section.getByText("Maya Patel")).toBeInTheDocument();
    // No display designated, so the identifier is the label rather than the id.
    expect(section.getByText("sol@acme.com")).toBeInTheDocument();
  });

  it("shows the granted person to themselves on the granter's project", async () => {
    // The person owns nothing: the page opens because somebody granted them
    // access to their project, and they see themselves in it.
    const queries = stubProject(
      [
        grant({
          project_id: "proj_theirs",
          user: grantUser({ user_id: "user_test", identifier: SELF }),
        }),
      ],
      project("proj_theirs", "Granted to me"),
    );
    await renderProject("proj_theirs");

    expect(await screen.findByRole("heading", { name: "Granted to me" })).toBeInTheDocument();
    expect(admins().getByText(SELF)).toBeInTheDocument();
    expect(queries.map((query) => query.projectId)).toEqual(["proj_theirs"]);
  });

  it("falls back to the principal id when the principal cannot be loaded", async () => {
    // A deleted user's surviving grant is a degraded ref: `user_id` only.
    stubProject([grant({ user: { user_id: "user_1" } })]);
    await renderProject();

    await screen.findByRole("region", { name: "Admins" });
    expect(admins().getByText("user_1")).toBeInTheDocument();
  });

  it("renders whatever relation a grant carries, not just admin", async () => {
    // The section only creates `admin`, but the catalog has three relations and
    // a grant made elsewhere must not be mislabelled.
    stubProject([grant({ relation: "viewer", user: grantUser({ identifier: "vi@acme.com" }) })]);
    await renderProject();

    await screen.findByRole("region", { name: "Admins" });
    expect(admins().getByText("Viewer")).toBeInTheDocument();
  });

  it("labels a team principal by its name", async () => {
    // A team grant carries `team` and omits `user`. `name` is already on the ref.
    stubProject([
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
    ]);
    await renderProject();

    await screen.findByRole("region", { name: "Admins" });
    expect(admins().getByText("Platform")).toBeInTheDocument();
  });

  it("says so when nobody has been granted access", async () => {
    // Right after claiming: the owner's access comes through the owning team,
    // not an admin grant, so their own project lists nobody. That is correct.
    stubProject([]);
    await renderProject();

    await screen.findByRole("region", { name: "Admins" });
    expect(admins().getByText("No admins yet.")).toBeInTheDocument();
    expect(admins().getByRole("button", { name: "Add admin" })).toBeInTheDocument();
  });

  it("grants by the address that was typed, on the route's project", async () => {
    stubProject([]);
    const created = stubCreateGrant();
    await renderProject();

    const { input, submit } = await openAddAdmin();
    await userEvent.type(input, "colleague@acme.com");
    await userEvent.click(submit);

    // The identifier locator, on the route's project, at the only level this
    // journey grants (#769).
    await waitFor(() =>
      expect(created.at(-1)).toEqual({
        projectId: PROJECT_ID,
        body: { user: { identifier: "colleague@acme.com" }, relation: "admin" },
      }),
    );
    expect(await screen.findByText(NEUTRAL_MESSAGE)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("says the same thing for an address that belongs to nobody", async () => {
    // The 202 carries no body, so the console has nothing to branch on and the
    // operator learns nothing about who is registered.
    stubProject([]);
    stubCreateGrant();
    let userQueries = 0;
    server.use(
      http.post(USERS_QUERY_URL, () => {
        userQueries += 1;
        return HttpResponse.json({ users: [] });
      }),
    );
    await renderProject();

    const { input, submit } = await openAddAdmin();
    await userEvent.type(input, "nobody@acme.com");
    await userEvent.click(submit);

    expect(await screen.findByText(NEUTRAL_MESSAGE)).toBeInTheDocument();
    // No directory read: the old picker listed everyone to whoever opened it.
    expect(userQueries).toBe(0);
  });

  it("refuses the operator's own address without sending it", async () => {
    // Different case and surrounding spaces: the comparison is on the trimmed
    // value, case-insensitively, because the address is the same address.
    stubProject([]);
    const created = stubCreateGrant();
    await renderProject();

    const { dialog, input, submit } = await openAddAdmin();
    await userEvent.type(input, "  Test.User@example.com  ");
    await userEvent.click(submit);

    expect(await dialog.findByRole("alert")).toHaveTextContent(SELF_MESSAGE);
    expect(input).toBeInvalid();
    expect(input).toHaveAccessibleDescription(SELF_MESSAGE);
    expect(created).toHaveLength(0);

    // Editing makes it a different address, and the refusal was about the old
    // one. `FieldError` renders nothing at all when it has no message, so the
    // alert is gone rather than empty. The replacement is a well-formed
    // address on purpose: `toBeInvalid` also reads native constraint
    // validation, so appending to this one would fail the format check and say
    // nothing about the error that was meant to be cleared.
    await userEvent.clear(input);
    await userEvent.type(input, "colleague@acme.com");
    expect(dialog.queryByRole("alert")).not.toBeInTheDocument();
    expect(input).not.toBeInvalid();
  });

  it("leaves a malformed address to the browser", async () => {
    // `type="email"` refuses it before the handler runs, so there is no
    // console-authored format message to keep in step with the server's.
    stubProject([]);
    const created = stubCreateGrant();
    await renderProject();

    const { input, submit } = await openAddAdmin();
    await userEvent.type(input, "not-an-email");
    await userEvent.click(submit);

    expect(input).toBeInvalid();
    expect(created).toHaveLength(0);
  });

  it("surfaces the API's own message when the grant is refused", async () => {
    // ADR 030 makes the payload's `message` the human-facing string. Signed in
    // without an identifier, the console cannot run its own self check, so
    // self-granting comes back as the API's `grant.invalid` instead. One
    // resolved value is enough: the guard reads the session once per render,
    // and this submit fails, so nothing invalidates the route and reads it again.
    const { fetchSession } = await import("@/auth/session");
    // A schema that designates no identifier leaves the field off the session
    // user entirely, rather than carrying it as undefined.
    const { user, ...session } = makeTestSession();
    vi.mocked(fetchSession).mockResolvedValueOnce({
      ...session,
      user: user && { user_id: user.user_id, display: user.display },
    });
    stubProject([]);
    server.use(
      http.post(GRANTS_URL, () =>
        HttpResponse.json(
          { code: "grant.invalid", message: "you cannot grant access to yourself" },
          { status: 400 },
        ),
      ),
    );
    await renderProject();

    const { dialog, input, submit } = await openAddAdmin();
    await userEvent.type(input, SELF);
    await userEvent.click(submit);

    expect(await dialog.findByRole("alert")).toHaveTextContent(
      "you cannot grant access to yourself",
    );
  });

  it("names the relation the row holds, not always admin", async () => {
    // The section only creates `admin`, but the list shows whatever a grant
    // carries, and "Remove admin" over a `viewer` row would misdescribe the
    // click.
    stubProject([grant({ relation: "viewer", user: grantUser({ display: "Sasha Kim" }) })]);
    await renderProject();

    await userEvent.click(await screen.findByRole("button", { name: "Actions for Sasha Kim" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Remove viewer" }));
    const dialog = within(await screen.findByRole("alertdialog"));
    expect(dialog.getByText("Remove viewer?")).toBeInTheDocument();
  });

  it("removes an admin from the route's project after confirming", async () => {
    // The revoke is scoped like the read: `DELETE /grants/{id}` carries the
    // route's project, not the console's own.
    stubProject([grant({ user: grantUser({ display: "Maya Patel" }) })]);
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
    await renderProject();

    await userEvent.click(await screen.findByRole("button", { name: "Actions for Maya Patel" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Remove admin" }));
    const dialog = within(await screen.findByRole("alertdialog"));
    expect(dialog.getByText("Remove admin?")).toBeInTheDocument();
    await userEvent.click(dialog.getByRole("button", { name: "Remove admin" }));

    await waitFor(() => expect(deleted).toEqual({ id: "asgn_1", projectId: PROJECT_ID }));
  });

  it("does not carry a failed removal into the next opening", async () => {
    // The dialog content is mounted per opening, so the error from one attempt
    // is not sitting there when the operator opens it again.
    stubProject([grant({ user: grantUser({ display: "Maya Patel" }) })]);
    server.use(
      http.delete(`${GRANTS_URL}/:id`, () =>
        HttpResponse.json({ code: "grant.not_found", message: "no such grant" }, { status: 404 }),
      ),
    );
    await renderProject();

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

  it("keeps the row when the removal is cancelled", async () => {
    stubProject([grant({ user: grantUser({ display: "Maya Patel" }) })]);
    let deleteCalls = 0;
    server.use(
      http.delete(`${GRANTS_URL}/:id`, () => {
        deleteCalls += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await renderProject();

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
  it("has no Admins entry anywhere in the sidebar", async () => {
    // Admins lives on the project page now; neither the portal list nor the
    // Settings view advertises it.
    stubProject([]);
    await renderProject();

    const primary = await screen.findByRole("navigation", { name: "Primary" });
    expect(within(primary).queryByRole("link", { name: /Admins/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "WORKSPACE" })).not.toBeInTheDocument();
  });
});
