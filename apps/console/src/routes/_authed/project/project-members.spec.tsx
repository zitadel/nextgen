import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import {
  NEUTRAL_MESSAGE,
  SELF_MESSAGE,
} from "@/features/project-settings/components/add-admin-dialog";
import { formatDate } from "@/lib/date";
import { scopedPath } from "@/test/project-scope.fixture";
import { makeTestSession } from "@/test/session.fixture";
import { server } from "@/test/msw";
import { createAppRouter } from "../../../router";

// The `_authed` layout guards every screen behind `GET /sessions/me`
// (Console ADR 0003); mock the auth module so routes render as signed in.
vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  const { makeTestSession } = await import("@/test/session.fixture");
  return { ...actual, fetchSession: vi.fn(async () => makeTestSession()) };
});

/**
 * The project's Members page (#2857). The rows come from the members list and
 * the grants of the route's project, never the console's own (platform)
 * project; the grouping rules themselves are `members.spec.ts`'s. This spec
 * covers what the page does with them: the cells, a team's disclosure, the
 * row menus and their confirmations, and adding an admin.
 */
const PROJECT_ID = "proj_1";
const PROJECTS_URL = "http://localhost/api/v1/projects";
const GRANTS_URL = "http://localhost/api/v1/grants";
const GRANTS_QUERY_URL = `${GRANTS_URL}/query`;
const USERS_QUERY_URL = "http://localhost/api/v1/users/query";
/** The signed-in address, read from the fixture rather than restated here. */
const SELF = makeTestSession().user?.identifier ?? "";

async function renderProject(projectId = PROJECT_ID) {
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

const OPS = { team_id: "team_ops", name: "Ops" };
const MAYA = { user_id: "user_maya", display: "Maya Patel", identifier: "maya@acme.com" };
const ADA = { user_id: "user_ada", display: "Ada Lovelace", identifier: "ada@acme.com" };

function grant(overrides: Record<string, unknown> = {}) {
  return {
    id: "asgn_1",
    project_id: PROJECT_ID,
    object_type: "project",
    relation: "admin",
    created_at: "2026-09-01T10:00:00Z",
    user: MAYA,
    ...overrides,
  };
}

/** One person on the members list, with the sources they hold. */
function member(
  user: Record<string, unknown>,
  relation: string,
  sources: Record<string, unknown>[],
) {
  return { user, relation, sources };
}

/**
 * The project, its members and its grants. Records the project each members
 * read and each `POST /grants/query` was scoped to.
 */
function stubProject(
  {
    members = [],
    grants = [],
  }: { members?: Record<string, unknown>[]; grants?: Record<string, unknown>[] } = {},
  record = project(),
) {
  const memberReads: string[] = [];
  const grantReads: (string | null)[] = [];
  server.use(
    http.get(`${PROJECTS_URL}/:id`, () => HttpResponse.json(record)),
    http.get("http://localhost/api/v1/variables", () => HttpResponse.json({})),
    http.get("http://localhost/api/v1/deployments", () =>
      HttpResponse.json({ deployments: [], next_page_token: null }),
    ),
    http.get(`${PROJECTS_URL}/:id/members`, ({ params }) => {
      memberReads.push(params.id as string);
      return HttpResponse.json({ members });
    }),
    http.post(GRANTS_QUERY_URL, ({ request }) => {
      grantReads.push(new URL(request.url).searchParams.get("project_id"));
      return HttpResponse.json({ grants });
    }),
  );
  return { memberReads, grantReads };
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

/** Every `DELETE /grants/{grant_id}` the console sends, with the project it named. */
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

function membersTable() {
  return within(screen.getByRole("region", { name: "Members" }));
}

/** Opens Members from the project's Settings list, where the table and the Add button live. */
async function openMembers() {
  const nav = within(await screen.findByRole("navigation", { name: "Project settings" }));
  await userEvent.click(nav.getByRole("link", { name: "Members" }));
  return within(await screen.findByRole("region", { name: "Members" }));
}

/** The row labelled by a person or team, found by its name. */
function row(name: string) {
  return within(membersTable().getByRole("row", { name: new RegExp(name) }));
}

/** From any page: opens Members, then the row's menu, then its confirmation. */
async function openRemove(name: string, item = "Remove access") {
  await openMembers();
  await userEvent.click(screen.getByRole("button", { name: `Actions for ${name}` }));
  await userEvent.click(await screen.findByRole("menuitem", { name: item }));
  return within(await screen.findByRole("alertdialog"));
}

async function openAddAdmin() {
  await openMembers();
  await userEvent.click(screen.getByRole("button", { name: "Add admin" }));
  const dialog = within(await screen.findByRole("dialog"));
  return {
    dialog,
    input: dialog.getByRole("textbox", { name: "Email address" }),
    // The dialog's own submit, not the trigger that shares its label.
    submit: dialog.getByRole("button", { name: "Add admin" }),
  };
}

describe("project members", () => {
  it("reads the members and the grants of the route's project", async () => {
    const { memberReads, grantReads } = stubProject({
      members: [member(MAYA, "admin", [{ type: "grant", grant_id: "asgn_1" }])],
      grants: [grant()],
    });
    await renderProject();

    const section = await openMembers();
    expect(memberReads).toEqual([PROJECT_ID]);
    expect(grantReads).toEqual([PROJECT_ID]);
    const maya = row("Maya Patel");
    // The identifier under the display name, the role, and no end date.
    expect(maya.getByText("maya@acme.com")).toBeInTheDocument();
    expect(maya.getByText("Admin")).toBeInTheDocument();
    expect(maya.getByText("—")).toBeInTheDocument();
    expect(section.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Member",
      "Role",
      "Expires at",
      "Actions",
    ]);
  });

  it("marks the viewer's own row, and offers no action on it", async () => {
    // Leaving a project has no endpoint yet (#2863).
    stubProject({ grants: [grant({ user: { user_id: "user_test", identifier: SELF } })] });
    await renderProject();

    await openMembers();
    const self = row(SELF);
    expect(self.getByText(`${SELF} (you)`)).toBeInTheDocument();
    expect(self.queryByRole("button", { name: /Actions for/ })).not.toBeInTheDocument();
  });

  it("shows when a grant ends, and when it has", async () => {
    stubProject({
      grants: [
        grant({ expires_at: "2099-12-31T00:00:00Z" }),
        grant({ id: "asgn_2", user: ADA, expires_at: "2020-01-01T00:00:00Z" }),
      ],
    });
    await renderProject();

    await openMembers();
    expect(row("Maya Patel").getByText(formatDate("2099-12-31T00:00:00Z"))).toBeInTheDocument();
    expect(row("Ada Lovelace").getByText("Expired")).toBeInTheDocument();
  });

  it("opens a team to the people who hold the project through it", async () => {
    stubProject({
      members: [member(ADA, "editor", [{ type: "grant", grant_id: "asgn_ops", team: OPS }])],
      grants: [grant({ id: "asgn_ops", relation: "editor", user: undefined, team: OPS })],
    });
    await renderProject();

    await openMembers();
    const ops = row("Ops");
    expect(ops.getByText("Team")).toBeInTheDocument();
    expect(ops.getByText("1 member")).toBeInTheDocument();
    expect(membersTable().queryByText("Ada Lovelace")).not.toBeInTheDocument();

    await userEvent.click(ops.getByRole("button", { name: "Show the members of Ops" }));
    expect(row("Ada Lovelace").getByText("Via team")).toBeInTheDocument();
    expect(ops.getByRole("button", { name: "Hide the members of Ops" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("removes a person's access from the route's project after confirming", async () => {
    stubProject({ grants: [grant()] });
    const deleted = stubDeleteGrant();
    await renderProject();

    const dialog = await openRemove("Maya Patel");
    expect(dialog.getByText("Remove access?")).toBeInTheDocument();
    expect(
      dialog.getByText(
        "Maya Patel will lose access to this project, unless they hold it through a team.",
      ),
    ).toBeInTheDocument();
    await userEvent.click(dialog.getByRole("button", { name: "Remove access" }));
    expect(await screen.findByText("Access removed")).toBeInTheDocument();

    await waitFor(() => expect(deleted).toEqual([{ id: "asgn_1", projectId: PROJECT_ID }]));
  });

  it("says a person keeps the project through their team", async () => {
    stubProject({
      members: [member(MAYA, "admin", [{ type: "grant", grant_id: "asgn_ops", team: OPS }])],
      grants: [grant(), grant({ id: "asgn_ops", user: undefined, team: OPS })],
    });
    await renderProject();

    const dialog = await openRemove("Maya Patel");
    expect(
      dialog.getByText("Maya Patel keeps access to this project through Ops."),
    ).toBeInTheDocument();
  });

  it("removes a team's access, naming how many people it takes it from", async () => {
    stubProject({
      members: [
        member(ADA, "editor", [{ type: "grant", grant_id: "asgn_ops", team: OPS }]),
        member(MAYA, "editor", [{ type: "grant", grant_id: "asgn_ops", team: OPS }]),
      ],
      grants: [grant({ id: "asgn_ops", relation: "editor", user: undefined, team: OPS })],
    });
    const deleted = stubDeleteGrant();
    await renderProject();

    const dialog = await openRemove("Ops");
    expect(
      dialog.getByText(
        "Ops will lose access to this project, and so will its 2 members unless they hold it another way.",
      ),
    ).toBeInTheDocument();
    await userEvent.click(dialog.getByRole("button", { name: "Remove access" }));
    await waitFor(() => expect(deleted).toEqual([{ id: "asgn_ops", projectId: PROJECT_ID }]));
  });

  it("removes the weaker of two roles, keeping the stronger", async () => {
    stubProject({
      grants: [grant(), grant({ id: "asgn_2", relation: "editor" })],
    });
    const deleted = stubDeleteGrant();
    await renderProject();

    await openMembers();
    expect(row("Maya Patel").getByText("Admin, Editor")).toBeInTheDocument();
    const dialog = await openRemove("Maya Patel", "Remove role");
    expect(dialog.getByText("Remove editor role?")).toBeInTheDocument();
    expect(dialog.getByText("Maya Patel keeps admin access to this project.")).toBeInTheDocument();
    await userEvent.click(dialog.getByRole("button", { name: "Remove role" }));
    expect(await screen.findByText("Role removed")).toBeInTheDocument();
    await waitFor(() => expect(deleted).toEqual([{ id: "asgn_2", projectId: PROJECT_ID }]));
  });

  it("does not carry a failed removal into the next opening", async () => {
    // The dialog content is mounted per opening, so the error from one attempt
    // is not sitting there when the operator opens it again.
    stubProject({ grants: [grant()] });
    server.use(
      http.delete(`${GRANTS_URL}/:id`, () =>
        HttpResponse.json({ code: "grant.not_found", message: "no such grant" }, { status: 404 }),
      ),
    );
    await renderProject();

    const dialog = await openRemove("Maya Patel");
    await userEvent.click(dialog.getByRole("button", { name: "Remove access" }));
    expect(await screen.findByText("no such grant")).toBeInTheDocument();

    await userEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    await openRemove("Maya Patel");
    expect(screen.queryByText("no such grant")).not.toBeInTheDocument();
  });

  it("reloads what is left when one of a row's grants fails to go", async () => {
    const { memberReads } = stubProject({
      grants: [grant(), grant({ id: "asgn_2", expires_at: "2027-01-31T00:00:00Z" })],
    });
    server.use(
      http.delete(`${GRANTS_URL}/:id`, ({ params }) =>
        params.id === "asgn_2"
          ? HttpResponse.json(
              { code: "grant.not_found", message: "no such grant" },
              { status: 404 },
            )
          : new HttpResponse(null, { status: 204 }),
      ),
    );
    await renderProject();

    const dialog = await openRemove("Maya Patel");
    const reads = memberReads.length;
    await userEvent.click(dialog.getByRole("button", { name: "Remove access" }));
    expect(await screen.findByText("no such grant")).toBeInTheDocument();
    await waitFor(() => expect(memberReads.length).toBeGreaterThan(reads));
    expect(screen.queryByText("Access removed")).not.toBeInTheDocument();
  });

  it("keeps the row when the removal is cancelled", async () => {
    stubProject({ grants: [grant()] });
    const deleted = stubDeleteGrant();
    await renderProject();

    const dialog = await openRemove("Maya Patel");
    await userEvent.click(dialog.getByRole("button", { name: "Cancel" }));

    expect(deleted).toHaveLength(0);
    expect(screen.getByText("Maya Patel")).toBeInTheDocument();
  });

  it("says so when there is nobody to show", async () => {
    stubProject();
    await renderProject();

    await openMembers();
    expect(membersTable().getByText("No members yet")).toBeInTheDocument();
    expect(membersTable().queryByRole("table")).not.toBeInTheDocument();
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
    // self-granting comes back as the API's `grant.invalid` instead. The guard
    // reads the session on every navigation, and opening Members is one, so the
    // session stays this one for the whole test.
    const { fetchSession } = await import("@/auth/session");
    // A schema that designates no identifier leaves the field off the session
    // user entirely, rather than carrying it as undefined.
    const { user, ...session } = makeTestSession();
    vi.mocked(fetchSession).mockResolvedValue({
      ...session,
      user: user && { user_id: user.user_id, display: user.display },
    });
    onTestFinished(() => {
      vi.mocked(fetchSession).mockImplementation(async () => makeTestSession());
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
});

describe("project settings nav", () => {
  it("lists Members among the project's Settings, not its screens", async () => {
    // Members is a page of the project's Settings (D40), not a list screen
    // beside Users: the project's list is not drawn while its Settings are.
    stubProject();
    await renderProject();

    const nav = await screen.findByRole("navigation", { name: "Project settings" });
    expect(within(nav).getByRole("link", { name: "Members" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();
  });
});
