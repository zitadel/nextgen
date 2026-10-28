import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { scopedPath } from "@/test/project-scope.fixture";

// Safe as a static import where `@/auth/session` is not: the fixture's only
// dependency on it is a type, which the transform erases.
import { makeTestSession } from "@/test/session.fixture";
import { server } from "@/test/msw";

// The `_authed` layout guards every screen behind `GET /sessions/me`
// (Console ADR 0003); mock the auth module so routes render as signed in.
vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  const { makeTestSession } = await import("@/test/session.fixture");
  return { ...actual, fetchSession: vi.fn(async () => makeTestSession()) };
});

// Loaded after the env stub, for the same reason `renderProject` imports the
// router dynamically: the API client reads its base once, at module load, and a
// static import would run before the stub and send every request to port 3000.
const { NEUTRAL_MESSAGE, SELF_MESSAGE } = await import("@/components/add-admin-dialog");

/**
 * The admins section of the project page (#1238, #1462). The people and how
 * they hold access come from the project's admins list; team grants and lower
 * levels from its grants. Every read, add and remove goes against the route's
 * project id, never the console's own (platform) project.
 */
const PROJECT_ID = "proj_1";
const PROJECTS_URL = "http://localhost/api/projects";
const GRANTS_URL = "http://localhost/api/grants";
const GRANTS_QUERY_URL = `${GRANTS_URL}/query`;
const USERS_QUERY_URL = "http://localhost/api/users/query";
/** The signed-in address, read from the fixture rather than restated here. */
const SELF = makeTestSession().user?.identifier ?? "";

async function renderProject(projectId = PROJECT_ID) {
  const [{ RouterProvider, createMemoryHistory }, { createAppRouter }] = await Promise.all([
    import("@tanstack/react-router"),
    import("../../../router"),
  ]);
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [scopedPath("/project", projectId)] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

function project(id = PROJECT_ID, name = "Acme") {
  return {
    id,
    name,
    origins: [],
    created_at: "2026-07-08T09:00:00Z",
    updated_at: "2026-07-08T09:00:00Z",
  };
}

const OWNING_TEAM = { team_id: "team_owner", name: "Acme founders" };
const GRANTED_TEAM = { team_id: "team_ops", name: "Operations" };

/** One source as the admins list serves it. */
const source = {
  owningTeam: (team = OWNING_TEAM) => ({ type: "owning_team", team }),
  grant: (grant_id = "asgn_1") => ({ type: "grant", grant_id }),
  teamGrant: (grant_id = "asgn_team", team: { team_id: string; name?: string } = GRANTED_TEAM) => ({
    type: "grant",
    grant_id,
    team,
  }),
};

/** One person on the admins list, with the sources they hold. */
function admin(user: Record<string, unknown>, sources: Record<string, unknown>[]) {
  return { user, sources };
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

/** A grant's user ref: the id, and whatever identity the schema designates. */
function grantUser(identity: Record<string, unknown>) {
  return { user_id: "user_1", ...identity };
}

/** A grant's team ref: the id, and the name where the viewer may see it. */
function grantTeam(team = GRANTED_TEAM) {
  return { ...team };
}

/** One `POST /grants/query` as the section sends it: which project, and what body. */
interface GrantsQuery {
  projectId: string | null;
  body: Record<string, unknown>;
}

/**
 * The project, its admins and its grants. Records every admins read and every
 * `POST /grants/query`, so both the project each request was scoped to and the
 * expansion sent can be asserted.
 */
function stubProject(
  {
    admins = [],
    grants = [],
  }: { admins?: Record<string, unknown>[]; grants?: Record<string, unknown>[] } = {},
  record = project(),
) {
  const adminReads: string[] = [];
  const queries: GrantsQuery[] = [];
  server.use(
    http.get(`${PROJECTS_URL}/:id`, () => HttpResponse.json(record)),
    // The page's variables and policy cards read alongside; none keeps these
    // tests about the admins.
    http.get("http://localhost/api/variables", () => HttpResponse.json({})),
    http.get("http://localhost/api/policies", () =>
      HttpResponse.json({ policies: [], next_page_token: null }),
    ),
    http.get(`${PROJECTS_URL}/:id/admins`, ({ params }) => {
      adminReads.push(params.id as string);
      return HttpResponse.json({ admins });
    }),
    http.post(GRANTS_QUERY_URL, async ({ request }) => {
      const projectId = new URL(request.url).searchParams.get("project_id");
      queries.push({ projectId, body: (await request.json()) as Record<string, unknown> });
      return HttpResponse.json({ grants });
    }),
  );
  return { adminReads, queries };
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

/** Every `DELETE /grants/{id}` the console sends, with the project it named. */
function stubDeleteGrant() {
  const deleted: { id: string; projectId: string | null }[] = [];
  server.use(
    http.delete(`${GRANTS_URL}/:id`, ({ params, request }) => {
      deleted.push({
        id: params.id as string,
        projectId: new URL(request.url).searchParams.get("project_id"),
      });
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return deleted;
}

function admins() {
  return within(screen.getByRole("region", { name: "Admins" }));
}

/** Opens the Admins tab, where the list and the Add button live. */
async function openAdmins() {
  await userEvent.click(await screen.findByRole("tab", { name: "Admins" }));
  return within(await screen.findByRole("region", { name: "Admins" }));
}

/** The row labelled by a person or team, found by its name. */
function row(name: string) {
  return within(admins().getByRole("row", { name: new RegExp(name) }));
}

/** From any tab: opens Admins, then the row's menu, then its confirmation. */
async function openRemove(name: string, level = "admin") {
  await openAdmins();
  await userEvent.click(screen.getByRole("button", { name: `Actions for ${name}` }));
  await userEvent.click(await screen.findByRole("menuitem", { name: `Remove ${level}` }));
  return within(await screen.findByRole("alertdialog"));
}

async function openAddAdmin() {
  await openAdmins();
  await userEvent.click(screen.getByRole("button", { name: "Add admin" }));
  const dialog = within(await screen.findByRole("dialog"));
  return {
    dialog,
    input: dialog.getByRole("textbox", { name: "Email address" }),
    // The dialog's own submit, not the trigger that shares its label.
    submit: dialog.getByRole("button", { name: "Add admin" }),
  };
}

describe("project admins", () => {
  it("reads the admins and the grants of the route's project", async () => {
    // One read each, scoped to the project on the URL — not to the console's
    // own project — and not a read per row: the admins list resolves its
    // people, and a grant's ref carries its principal's name (ADR 059), so
    // nothing is expanded.
    const { adminReads, queries } = stubProject({
      admins: [
        admin({ user_id: "user_1", display: "Maya Patel", identifier: "maya@acme.com" }, [
          source.grant(),
        ]),
        admin({ user_id: "user_2", identifier: "sol@acme.com" }, [source.grant("asgn_2")]),
      ],
    });
    await renderProject();

    const section = await openAdmins();
    expect(adminReads).toEqual([PROJECT_ID]);
    expect(queries).toHaveLength(1);
    expect(queries[0]).toEqual({ projectId: PROJECT_ID, body: { limit: 100 } });
    expect(section.getByText("Maya Patel")).toBeInTheDocument();
    // No display designated, so the identifier is the label rather than the id.
    expect(section.getByText("sol@acme.com")).toBeInTheDocument();
  });

  it("lists the owner through the owning team, and marks the viewer's own row", async () => {
    // Right after local setup (#1462): the person who claimed the project holds
    // no grant, and used to be missing from this list entirely. The session
    // fixture signs in as `user_test`.
    stubProject({
      admins: [admin({ user_id: "user_test", identifier: SELF }, [source.owningTeam()])],
    });
    await renderProject();

    await openAdmins();
    const self = row(SELF);
    expect(self.getByText("Owning team")).toBeInTheDocument();
    expect(self.getByText("(you)")).toBeInTheDocument();
    // Not a grant, so nothing to revoke from here.
    expect(self.queryByRole("button", { name: /Actions for/ })).not.toBeInTheDocument();
    expect(admins().queryByText("No admins to show.")).not.toBeInTheDocument();
  });

  it("shows a person with both sources once, with each named", async () => {
    stubProject({
      admins: [
        admin({ user_id: "user_1", display: "Maya Patel" }, [
          source.owningTeam(),
          source.grant("asgn_maya"),
        ]),
      ],
      // Her direct grant is also in the grants read; it must not become a
      // second row.
      grants: [grant({ id: "asgn_maya", user: grantUser({ display: "Maya Patel" }) })],
    });
    await renderProject();

    await openAdmins();
    expect(admins().getAllByText("Maya Patel")).toHaveLength(1);
    expect(row("Maya Patel").getByText("Owning team and admin grant")).toBeInTheDocument();
  });

  it("says what stays when removing a grant from someone with other access", async () => {
    // Removing the explicit grant does not remove access through the owning
    // team, and the dialog must not imply it does.
    stubProject({
      admins: [
        admin({ user_id: "user_1", display: "Maya Patel" }, [
          source.owningTeam(),
          source.teamGrant(),
          source.grant("asgn_maya"),
        ]),
      ],
    });
    const deleted = stubDeleteGrant();
    await renderProject();

    await openAdmins();
    // One line however many sources, so the row keeps the list's height.
    expect(
      row("Maya Patel").getByText("Owning team, via team Operations and admin grant"),
    ).toBeInTheDocument();
    const dialog = await openRemove("Maya Patel");
    expect(dialog.getByText("Remove admin?")).toBeInTheDocument();
    expect(
      dialog.getByText(
        "This removes only the grant made to them directly. They keep admin access through the owning team and team Operations, so they can still manage this project.",
      ),
    ).toBeInTheDocument();
    expect(dialog.queryByText(/immediately lose access/)).not.toBeInTheDocument();
    await userEvent.click(dialog.getByRole("button", { name: "Remove admin" }));

    // The direct grant, not the team's.
    await waitFor(() => expect(deleted).toEqual([{ id: "asgn_maya", projectId: PROJECT_ID }]));
  });

  it("names access through a granted team, with no action on the person's row", async () => {
    // The grant is the team's: revoking it from a member's row would take the
    // project from everyone in the team.
    stubProject({
      admins: [admin({ user_id: "user_1", display: "Sol Reyes" }, [source.teamGrant()])],
    });
    await renderProject();

    await openAdmins();
    const sol = row("Sol Reyes");
    expect(sol.getByText("Via team Operations")).toBeInTheDocument();
    expect(sol.queryByRole("button", { name: /Actions for/ })).not.toBeInTheDocument();
  });

  it("names a team the viewer is not in by its id", async () => {
    // The API leaves the name off a team the caller may not see; the id is
    // always on the ref.
    stubProject({
      admins: [
        admin({ user_id: "user_1", display: "Sol Reyes" }, [
          source.teamGrant("asgn_x", { team_id: "team_hidden" }),
        ]),
      ],
    });
    await renderProject();

    await openAdmins();
    expect(row("Sol Reyes").getByText("Via team team_hidden")).toBeInTheDocument();
  });

  it("lists a team grant as the team's own row, and revokes it from there", async () => {
    // The admins list is people only, and leaves out members of a team the
    // viewer is not in; the grant to the team is still the project's.
    stubProject({
      grants: [grant({ id: "asgn_team", user: undefined, team: grantTeam() })],
    });
    const deleted = stubDeleteGrant();
    await renderProject();

    await openAdmins();
    expect(row("Operations").getByText("Admin grant")).toBeInTheDocument();
    const dialog = await openRemove("Operations");
    // A team's grant, so the copy is about its members, not "their account".
    expect(dialog.getByText(/Everyone in this team loses the access/)).toBeInTheDocument();
    await userEvent.click(dialog.getByRole("button", { name: "Remove admin" }));
    await waitFor(() => expect(deleted).toEqual([{ id: "asgn_team", projectId: PROJECT_ID }]));
  });

  it("keeps a direct grant the admins list leaves out, down to its id", async () => {
    // The admins list is live access by people who exist, so an expired grant
    // or a deleted user's is only on the grants read, as a degraded ref:
    // `user_id` only. It is still the project's, and still revocable here.
    stubProject({ grants: [grant({ user: { user_id: "user_1" } })] });
    const deleted = stubDeleteGrant();
    await renderProject();

    await openAdmins();
    expect(row("user_1").getByText("Admin grant")).toBeInTheDocument();
    const dialog = await openRemove("user_1");
    // A deleted user and one outside the viewer's read look the same, so the
    // copy claims neither that the account exists nor that it is gone.
    expect(dialog.getByText(/Nothing about this user can be read/)).toBeInTheDocument();
    expect(dialog.queryByText(/user account isn't deleted/)).not.toBeInTheDocument();
    await userEvent.click(dialog.getByRole("button", { name: "Remove admin" }));
    await waitFor(() => expect(deleted).toEqual([{ id: "asgn_1", projectId: PROJECT_ID }]));
  });

  it("says what stays when removing a lower grant from an admin", async () => {
    // A viewer grant to someone the owning team already makes an admin: the
    // grant is its own row, and taking it away leaves them the project.
    stubProject({
      admins: [admin({ user_id: "user_1", display: "Maya Patel" }, [source.owningTeam()])],
      grants: [
        grant({ id: "asgn_view", relation: "viewer", user: grantUser({ display: "Maya Patel" }) }),
      ],
    });
    await renderProject();

    const dialog = await openRemove("Maya Patel", "viewer");
    expect(dialog.getByText(/They keep admin access through the owning team/)).toBeInTheDocument();
  });

  const NOT_LISTED_LINE =
    "Your access to this Project isn’t a grant of your own, so you aren’t listed here.";

  it("tells a viewer with no row of their own why they are not listed", async () => {
    // A platform operator (ADR 075) reaches the project through neither a grant
    // nor the owning team, so nothing here is theirs.
    stubProject({
      admins: [admin({ user_id: "user_1", identifier: "colleague@acme.com" }, [source.grant()])],
    });
    await renderProject();

    await openAdmins();
    expect(admins().getByText(NOT_LISTED_LINE)).toBeInTheDocument();
    expect(admins().queryByText("(you)")).not.toBeInTheDocument();
  });

  it("marks the viewer's own lower grant instead", async () => {
    // The session fixture signs in as `user_test`.
    stubProject({
      grants: [
        grant({ relation: "viewer", user: grantUser({ user_id: "user_test", identifier: SELF }) }),
      ],
    });
    await renderProject();

    await openAdmins();
    expect(row(SELF).getByText("(you)")).toBeInTheDocument();
    expect(admins().queryByText(NOT_LISTED_LINE)).not.toBeInTheDocument();
  });

  it("renders whatever relation a grant carries, not just admin", async () => {
    // The section only creates `admin`, but the catalog has three relations,
    // the admins list leaves the others out, and a grant made elsewhere must
    // not be mislabelled or hidden.
    stubProject({
      grants: [grant({ relation: "viewer", user: grantUser({ identifier: "vi@acme.com" }) })],
    });
    await renderProject();

    await openAdmins();
    expect(row("vi@acme.com").getByText("Viewer grant")).toBeInTheDocument();
  });

  it("says so when there is nobody to show", async () => {
    stubProject();
    await renderProject();

    await openAdmins();
    expect(admins().getByText("No admins to show.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add admin" })).toBeInTheDocument();
  });

  it("grants by the address that was typed, on the route's project", async () => {
    stubProject();
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
    stubProject();
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
    stubProject();
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
    stubProject();
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
    stubProject();
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
    stubProject({
      grants: [grant({ relation: "viewer", user: grantUser({ display: "Sasha Kim" }) })],
    });
    await renderProject();

    const dialog = await openRemove("Sasha Kim", "viewer");
    expect(dialog.getByText("Remove viewer?")).toBeInTheDocument();
  });

  it("removes an admin from the route's project after confirming", async () => {
    // The revoke is scoped like the read: `DELETE /grants/{id}` carries the
    // route's project, not the console's own.
    stubProject({
      admins: [admin({ user_id: "user_1", display: "Maya Patel" }, [source.grant()])],
    });
    const deleted = stubDeleteGrant();
    await renderProject();

    const dialog = await openRemove("Maya Patel");
    expect(dialog.getByText("Remove admin?")).toBeInTheDocument();
    expect(dialog.getByText(/immediately lose access/)).toBeInTheDocument();
    await userEvent.click(dialog.getByRole("button", { name: "Remove admin" }));

    await waitFor(() => expect(deleted).toEqual([{ id: "asgn_1", projectId: PROJECT_ID }]));
  });

  it("does not carry a failed removal into the next opening", async () => {
    // The dialog content is mounted per opening, so the error from one attempt
    // is not sitting there when the operator opens it again.
    stubProject({
      admins: [admin({ user_id: "user_1", display: "Maya Patel" }, [source.grant()])],
    });
    server.use(
      http.delete(`${GRANTS_URL}/:id`, () =>
        HttpResponse.json({ code: "grant.not_found", message: "no such grant" }, { status: 404 }),
      ),
    );
    await renderProject();

    const dialog = await openRemove("Maya Patel");
    await userEvent.click(dialog.getByRole("button", { name: "Remove admin" }));
    expect(await screen.findByText("no such grant")).toBeInTheDocument();

    await userEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    await openRemove("Maya Patel");
    expect(screen.queryByText("no such grant")).not.toBeInTheDocument();
  });

  it("keeps the row when the removal is cancelled", async () => {
    stubProject({
      admins: [admin({ user_id: "user_1", display: "Maya Patel" }, [source.grant()])],
    });
    const deleted = stubDeleteGrant();
    await renderProject();

    const dialog = await openRemove("Maya Patel");
    await userEvent.click(dialog.getByRole("button", { name: "Cancel" }));

    expect(deleted).toHaveLength(0);
    expect(screen.getByText("Maya Patel")).toBeInTheDocument();
  });
});

describe("portal nav", () => {
  it("has no Admins entry in the primary sidebar", async () => {
    // Admins lives on the project page now, not as a list screen. The Settings
    // half of this is asserted where Settings renders (`landing.spec.tsx`):
    // on a project URL the Settings nav is never mounted.
    stubProject();
    await renderProject();

    const primary = await screen.findByRole("navigation", { name: "Primary" });
    expect(within(primary).queryByRole("link", { name: /Admins/ })).not.toBeInTheDocument();
  });
});
