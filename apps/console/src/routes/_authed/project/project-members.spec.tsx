import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
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
 * row menus and their confirmations.
 */
const PROJECT_ID = "proj_1";
const PROJECTS_URL = "http://localhost/api/v1/projects";
const GRANTS_URL = "http://localhost/api/v1/grants";
const GRANTS_QUERY_URL = `${GRANTS_URL}/query`;
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
    // The Invitations tab is read with the page; its own spec covers it.
    http.get("http://localhost/api/v1/invitations", () =>
      HttpResponse.json({ invitations: [], next_page_token: null }),
    ),
  );
  return { memberReads, grantReads };
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

/** Opens Members from the project's Settings list, where the table lives. */
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

  it("says access has already expired when clearing an expired row", async () => {
    stubProject({ grants: [grant({ expires_at: "2026-01-01T00:00:00Z" })] });
    await renderProject();

    const dialog = await openRemove("Maya Patel");
    expect(
      dialog.getByText(
        "Maya Patel's access to this project has expired. This removes it from the list.",
      ),
    ).toBeInTheDocument();
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

  it("says when the kept role ends", async () => {
    stubProject({
      grants: [
        grant({ expires_at: "2099-03-01T00:00:00Z" }),
        grant({ id: "asgn_2", relation: "viewer" }),
      ],
    });
    await renderProject();

    const dialog = await openRemove("Maya Patel", "Remove role");
    expect(
      dialog.getByText(
        `Maya Patel keeps admin access to this project until ${formatDate("2099-03-01T00:00:00Z")}.`,
      ),
    ).toBeInTheDocument();
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
    expect(await screen.findByText("No such grant")).toBeInTheDocument();

    await userEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    await openRemove("Maya Patel");
    expect(screen.queryByText("No such grant")).not.toBeInTheDocument();
  });

  it("reloads what is left when one of a row's grants fails to go", async () => {
    const { memberReads } = stubProject({
      // A live role and one that expired: removing access clears both grants.
      grants: [
        grant(),
        grant({ id: "asgn_2", relation: "editor", expires_at: "2026-01-01T00:00:00Z" }),
      ],
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
    expect(await screen.findByText("No such grant")).toBeInTheDocument();
    await waitFor(() => expect(memberReads.length).toBeGreaterThan(reads));
    expect(screen.queryByText("Access removed")).not.toBeInTheDocument();
    // The reload leaves the dialog and its error in place.
    expect(screen.getByText("No such grant")).toBeInTheDocument();
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
